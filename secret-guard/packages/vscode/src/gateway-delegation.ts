import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { RELAY_PROTOCOL } from "@xsom/secret-guard-relay";

const GATEWAY_PROTOCOL = "xsom-extension-gateway-v1";

/**
 * The relay a Claude session may delegate to. The xSOM gateway cleans on the
 * server, attachments included; the local relay cleans on this workstation
 * and lets images through only when the user chose so.
 */
export type LiveRelay =
  | { readonly kind: "gateway" }
  | { readonly kind: "local"; readonly unanalysed: "refuse" | "allow" };

export function routeFile(storage: string, base: string): string {
  return join(
    storage,
    `gateway-${createHash("sha256").update(base).digest("hex")}.json`,
  );
}

/** The live relay THIS assistant process uses, recorded by the extension. */
export async function liveRelay(
  storage: string,
  base: string | undefined,
): Promise<LiveRelay | undefined> {
  if (!base || !/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}$/u.test(base))
    return undefined;
  try {
    const descriptor = JSON.parse(
      await readFile(routeFile(storage, base), "utf8"),
    ) as { baseUrl?: unknown; unanalysed?: unknown };
    if (descriptor.baseUrl !== base) return undefined;
    const result = await fetch(`${base}/health`, {
      redirect: "error",
      signal: AbortSignal.timeout(1000),
    });
    const health = (await result.json()) as {
      protocol?: unknown;
      redaction?: unknown;
    };
    if (!result.ok || health.redaction !== "required") return undefined;
    if (health.protocol === GATEWAY_PROTOCOL) return { kind: "gateway" };
    if (health.protocol === RELAY_PROTOCOL)
      return {
        kind: "local",
        unanalysed: descriptor.unanalysed === "allow" ? "allow" : "refuse",
      };
    return undefined;
  } catch {
    return undefined;
  }
}

/** A native hook delegates only when THIS assistant process uses our live relay. */
export async function canDelegate(
  storage: string,
  base: string | undefined,
): Promise<boolean> {
  return (await liveRelay(storage, base)) !== undefined;
}

/** Whether a live relay is connected on this machine, whichever process uses it. */
export async function relayConnected(storage: string): Promise<boolean> {
  let names: string[];
  try {
    names = await readdir(storage);
  } catch {
    return false;
  }
  for (const name of names) {
    if (!/^gateway-[a-f0-9]{64}\.json$/u.test(name)) continue;
    try {
      const descriptor = JSON.parse(
        await readFile(join(storage, name), "utf8"),
      ) as { baseUrl?: unknown };
      if (
        typeof descriptor.baseUrl === "string" &&
        (await canDelegate(storage, descriptor.baseUrl))
      )
        return true;
    } catch {
      // An unreadable descriptor is not a live relay.
    }
  }
  return false;
}
