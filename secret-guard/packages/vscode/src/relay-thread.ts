import { once } from "node:events";
import { Worker } from "node:worker_threads";

import type { UnanalysedPolicy } from "@xsom/secret-guard-relay";

import type { RelayWorkerMessage } from "./relay-worker.js";

const START_TIMEOUT_MS = 10_000;
const STOP_GRACE_MS = 2_000;

export interface RelayThread {
  readonly baseUrl: string;
  stop: () => Promise<void>;
}

export interface ClaudeEnvEntry {
  readonly name: string;
  readonly value: string;
}

/** Starts the bundled relay worker and waits for its loopback address. */
export async function startRelayThread(
  workerFile: string,
  unanalysed: UnanalysedPolicy,
): Promise<RelayThread> {
  const worker = new Worker(workerFile, { workerData: { unanalysed } });
  const timer = setTimeout(() => {
    void worker.terminate();
  }, START_TIMEOUT_MS);
  try {
    const [message] = (await Promise.race([
      once(worker, "message"),
      once(worker, "exit").then(
        () => [{ type: "failed" }],
        () => [{ type: "failed" }],
      ),
    ])) as [RelayWorkerMessage];
    if (message.type !== "ready") throw new Error("local_relay_failed");
    return {
      baseUrl: message.baseUrl,
      stop: async () => {
        const grace = setTimeout(() => {
          void worker.terminate();
        }, STOP_GRACE_MS);
        worker.postMessage("close");
        await once(worker, "exit").catch(() => undefined);
        clearTimeout(grace);
      },
    };
  } catch (error) {
    await worker.terminate();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Claude Code's environment with our relay, or "conflict" when another base
 * URL that is not ours is already set: it is never silently replaced.
 */
export function withRelayBase(
  entries: readonly ClaudeEnvEntry[],
  base: string,
  previous: string | undefined,
): ClaudeEnvEntry[] | "conflict" {
  const current = entries.find(
    (entry) => entry.name === "ANTHROPIC_BASE_URL",
  )?.value;
  if (current !== undefined && current !== previous) return "conflict";
  return [
    ...entries.filter((entry) => entry.name !== "ANTHROPIC_BASE_URL"),
    { name: "ANTHROPIC_BASE_URL", value: base },
  ];
}

/** Claude Code's environment without our relay; other values stay. */
export function withoutRelayBase(
  entries: readonly ClaudeEnvEntry[],
  ours: string | undefined,
): ClaudeEnvEntry[] | undefined {
  if (
    ours === undefined ||
    !entries.some(
      (entry) => entry.name === "ANTHROPIC_BASE_URL" && entry.value === ours,
    )
  )
    return undefined;
  return entries.filter((entry) => entry.name !== "ANTHROPIC_BASE_URL");
}
