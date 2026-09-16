import { randomUUID } from "node:crypto";

export type AuditEvent = {
  event_id: string;
  at: string;
  kind:
    "scan" | "mode_changed" | "local_test" | "gateway_configured" | "heartbeat";
  assistant:
    "manual" | "secretguard" | "claude" | "codex" | "copilot" | "windsurf";
  mode: "block" | "redact" | "observe";
  outcome:
    | "clean"
    | "blocked"
    | "redacted"
    | "warned"
    | "passed"
    | "failed"
    | "configured";
  findings: number;
  dropped: number;
};

export function gatewayUrl(value: string): string {
  const url = new URL(value);
  const local =
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (!local && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("invalid_gateway_url");
  return url.href.replace(/\/$/u, "");
}

export async function gatewayJson(
  base: string,
  token: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetch(`${gatewayUrl(base)}${path}`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", "X-Gateway-Token": token },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`gateway_http_${response.status}`);
  if (!response.body) throw new Error("gateway_response_empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 64000) {
        await reader.cancel();
        throw new Error("gateway_response_too_large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export interface QueueState {
  events: AuditEvent[];
  dropped: number;
}

export class AuditQueue {
  private state: QueueState;
  private work: Promise<void> = Promise.resolve();
  public lastSync: "pending" | "ok" | "offline" = "pending";
  public constructor(
    initial: QueueState,
    private readonly save: (state: QueueState) => Promise<void>,
    private readonly send: (events: AuditEvent[]) => Promise<readonly string[]>,
  ) {
    this.state = initial;
  }
  public get pending(): number {
    return this.state.events.length;
  }
  public get dropped(): number {
    return this.state.dropped;
  }
  public enqueue(
    event: Omit<AuditEvent, "event_id" | "at" | "dropped">,
  ): Promise<void> {
    return this.serial(async () => {
      if (this.state.events.length >= 1000) {
        this.state.events.shift();
        this.state.dropped = Math.min(1000000000, this.state.dropped + 1);
      }
      this.state.events.push({
        ...event,
        event_id: randomUUID(),
        at: new Date().toISOString(),
        dropped: this.state.dropped,
      });
      await this.save(structuredClone(this.state));
    });
  }
  private serial(action: () => Promise<void>): Promise<void> {
    this.work = this.work.then(action, action).catch(() => {
      this.lastSync = "offline";
    });
    return this.work;
  }
  public flush(): Promise<void> {
    return this.serial(async () => {
      const batch = this.state.events.slice(0, 100);
      if (!batch.length) return;
      const accepted = new Set(await this.send(batch));
      if (
        accepted.size !== batch.length ||
        batch.some((event) => !accepted.has(event.event_id))
      )
        throw new Error("incomplete_ack");
      this.state.events = this.state.events.filter(
        (event) => !accepted.has(event.event_id),
      );
      await this.save(structuredClone(this.state));
      this.lastSync = "ok";
    });
  }
}
