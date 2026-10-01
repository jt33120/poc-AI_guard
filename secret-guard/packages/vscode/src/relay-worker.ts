import { parentPort, workerData } from "node:worker_threads";

import { startLocalRelay } from "@xsom/secret-guard-relay";

/** Messages between the extension host and the relay thread. */
export type RelayWorkerMessage =
  | { readonly type: "ready"; readonly baseUrl: string }
  | { readonly type: "failed" };

async function main(): Promise<void> {
  const port = parentPort;
  if (port === null) return;
  const data = workerData as { unanalysed?: unknown } | null;
  try {
    const relay = await startLocalRelay({
      unanalysed: data?.unanalysed === "allow" ? "allow" : "refuse",
    });
    port.on("message", (message: unknown) => {
      if (message !== "close") return;
      void relay.close().finally(() => {
        port.close();
      });
    });
    port.postMessage({
      type: "ready",
      baseUrl: relay.baseUrl,
    } satisfies RelayWorkerMessage);
  } catch {
    port.postMessage({ type: "failed" } satisfies RelayWorkerMessage);
  }
}

void main();
