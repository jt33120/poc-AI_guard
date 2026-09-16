import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function routeFile(storage: string, base: string): string {
  return join(
    storage,
    `gateway-${createHash("sha256").update(base).digest("hex")}.json`,
  );
}

/** A native hook delegates only when THIS assistant process uses our live relay. */
export async function canDelegate(
  storage: string,
  base: string | undefined,
): Promise<boolean> {
  if (!base || !/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}$/u.test(base))
    return false;
  try {
    const descriptor = JSON.parse(
      await readFile(routeFile(storage, base), "utf8"),
    ) as { baseUrl?: unknown };
    if (descriptor.baseUrl !== base) return false;
    const result = await fetch(`${base}/health`, {
      redirect: "error",
      signal: AbortSignal.timeout(1000),
    });
    const health = (await result.json()) as {
      protocol?: unknown;
      redaction?: unknown;
    };
    return (
      result.ok &&
      health.protocol === "xsom-extension-gateway-v1" &&
      health.redaction === "required"
    );
  } catch {
    return false;
  }
}
