import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import process from "node:process";
import { build } from "esbuild";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  AuditQueue,
  gatewayUrl,
  type AuditEvent,
  type QueueState,
} from "../../packages/vscode/src/gateway-client.js";
import {
  startGatewayBridge,
  type GatewayBridge,
} from "../../packages/vscode/src/gateway-bridge.js";
import {
  canDelegate,
  routeFile,
} from "../../packages/vscode/src/gateway-delegation.js";

const event = {
  kind: "scan",
  assistant: "claude",
  mode: "redact",
  outcome: "redacted",
  findings: 1,
} as const;
const resources: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const dispose of resources.splice(0).reverse()) await dispose();
});
async function remote(): Promise<{
  base: string;
  captured: { headers: Record<string, unknown>; path: string; body: string }[];
}> {
  const captured: {
    headers: Record<string, unknown>;
    path: string;
    body: string;
  }[] = [];
  const server: Server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      captured.push({
        headers: req.headers,
        path: req.url ?? "",
        body: Buffer.concat(chunks).toString(),
      });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end("event: message_stop\ndata: {}\n\n");
    })();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  resources.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  );
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    captured,
  };
}
async function bridge(base: string): Promise<GatewayBridge> {
  const result = await startGatewayBridge(base, "synthetic-gateway-token");
  resources.push(result.close);
  return result;
}

describe("metadata-only asynchronous audit", () => {
  it("persists offline events and retries with the same identifiers", async () => {
    let persisted: QueueState = { events: [], dropped: 0 };
    let offline = true;
    const sent: AuditEvent[][] = [];
    const queue = new AuditQueue(
      persisted,
      (state) => {
        persisted = state;
        return Promise.resolve();
      },
      (batch) => {
        sent.push(batch);
        if (offline) return Promise.reject(new Error("offline"));
        return Promise.resolve(batch.map((item) => item.event_id));
      },
    );
    await queue.enqueue(event);
    await queue.flush();
    expect(queue.pending).toBe(1);
    expect(queue.lastSync).toBe("offline");
    expect(JSON.stringify(persisted)).not.toContain("prompt");
    offline = false;
    await queue.flush();
    expect(sent[0]?.[0]?.event_id).toBe(sent[1]?.[0]?.event_id);
    expect(queue.pending).toBe(0);
    expect(persisted.events).toEqual([]);
  });
  it("bounds the queue and reports losses", async () => {
    const queue = new AuditQueue(
      { events: [], dropped: 0 },
      () => Promise.resolve(),
      () => Promise.resolve([]),
    );
    for (let i = 0; i < 1002; i++) await queue.enqueue(event);
    expect(queue.pending).toBe(1000);
    expect(queue.dropped).toBe(2);
    await queue.flush();
    expect(queue.pending).toBe(1000);
  });
  it("rejects insecure and credential-bearing endpoints", () => {
    for (const url of [
      "http://external.invalid",
      "https://user:pass@example.invalid",
      "https://example.invalid/?token=fake",
    ])
      expect(() => gatewayUrl(url)).toThrow();
    expect(gatewayUrl("https://example.invalid/")).toBe(
      "https://example.invalid",
    );
  });
});

describe("bounded subscription-compatible Claude relay", () => {
  it("the actual hook delegates redact only, and never malformed envelopes", async () => {
    const target = await remote();
    const relay = await bridge(target.base);
    const directory = await mkdtemp(join(tmpdir(), "xsom-real-hook-"));
    resources.push(() => rm(directory, { recursive: true, force: true }));
    const runner = join(directory, "hook.cjs");
    await build({
      entryPoints: ["packages/vscode/src/hook-entry.ts"],
      outfile: runner,
      bundle: true,
      platform: "node",
      format: "cjs",
    });
    await writeFile(
      routeFile(directory, relay.baseUrl),
      JSON.stringify({ baseUrl: relay.baseUrl }),
    );
    const run = (
      input: string,
      mode: string,
      base = relay.baseUrl,
    ): Promise<number | null> =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [runner, `--mode=${mode}`], {
          env: { ...process.env, ANTHROPIC_BASE_URL: base },
          windowsHide: true,
          timeout: 5000,
          stdio: ["pipe", "ignore", "ignore"],
        });
        child.on("error", reject);
        child.on("close", resolve);
        child.stdin.end(input);
      });
    const input = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      prompt: "PASSWORD=definitely-not-a-real-secret-123",
    });
    expect(await run(input, "redact")).toBe(0);
    expect(await run(input, "block")).toBe(2);
    expect(await run("{bad", "redact")).toBe(2);
    expect(await run(input, "redact", "http://127.0.0.1:1/unmanaged")).toBe(2);
  });
  it("passes assistant-owned OAuth/beta, isolates xSOM credentials and preserves SSE", async () => {
    const target = await remote();
    const relay = await bridge(target.base);
    const response = await fetch(`${relay.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        authorization: "Bearer synthetic-oauth",
        "anthropic-beta": "oauth-test",
        cookie: "must-not-relay",
        "x-gateway-token": "must-not-win",
      },
      body: '{"messages":[]}',
    });
    expect(await response.text()).toContain("message_stop");
    expect(target.captured[0]?.path).toBe(
      "/proxy/extension/anthropic/v1/messages",
    );
    expect(target.captured[0]?.headers.authorization).toBe(
      "Bearer synthetic-oauth",
    );
    expect(target.captured[0]?.headers["anthropic-beta"]).toBe("oauth-test");
    expect(target.captured[0]?.headers["x-gateway-token"]).toBe(
      "synthetic-gateway-token",
    );
    expect(target.captured[0]?.headers.cookie).toBeUndefined();
  });
  it("rejects browser origins, unknown paths and oversize bodies", async () => {
    const target = await remote();
    const relay = await bridge(target.base);
    expect(
      (
        await fetch(`${relay.baseUrl}/v1/messages`, {
          method: "POST",
          headers: { origin: "https://evil.invalid" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(`${relay.baseUrl}/anything`, { method: "POST" })).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${relay.baseUrl}/v1/messages`, {
          method: "POST",
          body: "x".repeat(1048577),
        })
      ).status,
    ).toBe(413);
    expect(target.captured).toHaveLength(0);
  });
  it("delegates only to a live locally recorded capability", async () => {
    const target = await remote();
    const relay = await bridge(target.base);
    const directory = await mkdtemp(join(tmpdir(), "xsom-delegation-test-"));
    resources.push(() => rm(directory, { recursive: true, force: true }));
    expect(await canDelegate(directory, relay.baseUrl)).toBe(false);
    await writeFile(
      routeFile(directory, relay.baseUrl),
      JSON.stringify({ baseUrl: relay.baseUrl }),
    );
    expect(await canDelegate(directory, relay.baseUrl)).toBe(true);
    expect(await canDelegate(directory, "https://example.invalid")).toBe(false);
  });
});
