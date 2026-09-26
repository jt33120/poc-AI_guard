import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { evaluateData, type DataPolicy } from "@xsom/developer-guard-policy";
import { evaluateResource } from "./paths.js";

export interface ResourceReadResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly content?: Buffer;
  readonly path?: string;
}

export async function readControlledResource(
  requestedPath: string,
  roots: readonly string[],
  dataPolicy?: DataPolicy,
): Promise<ResourceReadResult> {
  const lexical = evaluateResource(requestedPath, roots);
  if (!lexical.allowed) return lexical;
  try {
    const before = await lstat(lexical.normalized);
    if (before.isSymbolicLink())
      return { allowed: false, reason: "symbolic_link" };
    if (!before.isFile()) return { allowed: false, reason: "not_regular_file" };
    const canonical = await realpath(lexical.normalized);
    const canonicalRoots = await Promise.all(
      roots.map(async (root) => {
        try {
          return await realpath(root);
        } catch {
          return root;
        }
      }),
    );
    const resolved = evaluateResource(canonical, canonicalRoots);
    if (!resolved.allowed) return resolved;
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
    const handle = await open(canonical, flags);
    try {
      const current = await handle.stat();
      if (current.dev !== before.dev || current.ino !== before.ino)
        return { allowed: false, reason: "resource_changed" };
      const sample = Buffer.alloc(Math.min(current.size, 8192));
      if (sample.length > 0) await handle.read(sample, 0, sample.length, 0);
      const data = evaluateData(current.size, sample, dataPolicy);
      if (!data.allowed) return data;
      return {
        allowed: true,
        content: await handle.readFile(),
        path: canonical,
      };
    } finally {
      await handle.close();
    }
  } catch {
    return { allowed: false, reason: "resource_unavailable" };
  }
}
