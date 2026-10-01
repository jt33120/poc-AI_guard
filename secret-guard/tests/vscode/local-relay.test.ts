import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";

import {
  liveRelay,
  routeFile,
} from "../../packages/vscode/src/gateway-delegation.js";
import { delegation } from "../../packages/vscode/src/relay-delegation.js";
import {
  startRelayThread,
  withoutRelayBase,
  withRelayBase,
} from "../../packages/vscode/src/relay-thread.js";
import {
  RELAY_PROTOCOL,
  startLocalRelay,
} from "../../packages/relay/src/index.js";

const SECRET = `ghp_${"Ab3".repeat(12)}`;
const BASE = `http://127.0.0.1:4100/${"a".repeat(64)}`;
const resources: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const dispose of resources.splice(0).reverse()) await dispose();
});

async function temporary(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  resources.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

describe("which blocked events go to the relay", () => {
  const clean = { unanalysed: false, hidden: false, incomplete: false };
  const local = { kind: "local", unanalysed: "refuse" } as const;

  it("hands a secret over to the local relay, with a visible message", () => {
    expect(delegation(local, "prompt", clean)).toEqual({
      delegate: true,
      message: "🧹 Secret Guard · Prompt purgé avant envoi",
    });
    expect(delegation(local, "read", clean)).toMatchObject({ delegate: true });
  });

  it("keeps on the workstation what the local relay cannot clean", () => {
    expect(delegation(local, "prompt", { ...clean, hidden: true })).toEqual({
      delegate: false,
    });
    expect(delegation(local, "prompt", { ...clean, incomplete: true })).toEqual(
      { delegate: false },
    );
    // An image refused by the relay would block every following turn.
    expect(delegation(local, "read", { ...clean, unanalysed: true })).toEqual({
      delegate: false,
    });
  });

  it("lets screenshots through, announced, only when the user chose so", () => {
    expect(
      delegation({ kind: "local", unanalysed: "allow" }, "read", {
        ...clean,
        unanalysed: true,
      }),
    ).toEqual({
      delegate: true,
      message:
        "📷 Secret Guard · Fichier transmis sans analyse (captures d’écran autorisées)",
    });
  });

  it("leaves the xSOM gateway's behaviour unchanged", () => {
    expect(
      delegation({ kind: "gateway" }, "read", { ...clean, unanalysed: true }),
    ).toMatchObject({ delegate: true });
  });
});

describe("Claude Code's environment", () => {
  const other = { name: "HTTPS_PROXY", value: "http://proxy" };

  it("points Claude to the relay and keeps the other variables", () => {
    expect(withRelayBase([other], BASE, undefined)).toEqual([
      other,
      { name: "ANTHROPIC_BASE_URL", value: BASE },
    ]);
  });

  it("replaces its own previous address, never someone else's", () => {
    const previous = { name: "ANTHROPIC_BASE_URL", value: "http://old" };
    expect(withRelayBase([previous], BASE, "http://old")).toEqual([
      { name: "ANTHROPIC_BASE_URL", value: BASE },
    ]);
    expect(withRelayBase([previous], BASE, undefined)).toBe("conflict");
  });

  it("removes only its own address", () => {
    const ours = { name: "ANTHROPIC_BASE_URL", value: BASE };
    expect(withoutRelayBase([other, ours], BASE)).toEqual([other]);
    expect(withoutRelayBase([other, ours], "http://else")).toBeUndefined();
    expect(withoutRelayBase([other], undefined)).toBeUndefined();
  });
});

async function relayWorker(directory: string): Promise<string> {
  const file = join(directory, "relay-worker.cjs");
  await build({
    entryPoints: ["packages/vscode/src/relay-worker.ts"],
    outfile: file,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
  });
  return file;
}

describe("the relay thread", () => {
  it("serves the local relay off the main thread, then stops", async () => {
    const directory = await temporary("xsom-relay-thread-");
    const thread = await startRelayThread(
      await relayWorker(directory),
      "refuse",
    );
    const health = (await (await fetch(`${thread.baseUrl}/health`)).json()) as {
      protocol: string;
    };
    expect(health.protocol).toBe(RELAY_PROTOCOL);
    await thread.stop();
    await expect(fetch(`${thread.baseUrl}/health`)).rejects.toThrow();
  });

  it("reports a worker that cannot start", async () => {
    const directory = await temporary("xsom-relay-broken-");
    const file = join(directory, "broken.cjs");
    await writeFile(file, "throw new Error('boom');");
    await expect(startRelayThread(file, "refuse")).rejects.toThrow();
  });
});

describe("the hook with a local relay", () => {
  it("recognises the local relay and its image choice", async () => {
    const relay = await startLocalRelay({
      fetch: () => Promise.reject(new Error("offline")),
    });
    resources.push(() => relay.close());
    const directory = await temporary("xsom-live-local-");
    expect(await liveRelay(directory, relay.baseUrl)).toBeUndefined();
    await writeFile(
      routeFile(directory, relay.baseUrl),
      JSON.stringify({ baseUrl: relay.baseUrl, unanalysed: "allow" }),
    );
    expect(await liveRelay(directory, relay.baseUrl)).toEqual({
      kind: "local",
      unanalysed: "allow",
    });
  });

  it("purges secrets transparently, but keeps blocking what it cannot clean", async () => {
    const relay = await startLocalRelay({
      fetch: () => Promise.reject(new Error("offline")),
    });
    resources.push(() => relay.close());
    const directory = await temporary("xsom-local-hook-");
    const runner = join(directory, "hook.cjs");
    await build({
      entryPoints: ["packages/vscode/src/hook-entry.ts"],
      outfile: runner,
      bundle: true,
      platform: "node",
      format: "cjs",
      logLevel: "silent",
    });
    const record = (unanalysed: "allow" | "refuse") =>
      writeFile(
        routeFile(directory, relay.baseUrl),
        JSON.stringify({ baseUrl: relay.baseUrl, unanalysed }),
      );
    const image = join(directory, "capture.png");
    await writeFile(
      image,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    );
    const run = (
      payload: unknown,
      mode = "redact",
    ): Promise<{ code: number | null; stdout: string }> =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [runner, `--mode=${mode}`], {
          env: { ...process.env, ANTHROPIC_BASE_URL: relay.baseUrl },
          windowsHide: true,
          timeout: 5000,
          stdio: ["pipe", "pipe", "ignore"],
        });
        let stdout = "";
        child.stdout.on(
          "data",
          (chunk: Buffer) => (stdout += chunk.toString()),
        );
        child.on("error", reject);
        child.on("close", (code) => {
          resolve({ code, stdout });
        });
        child.stdin.end(JSON.stringify(payload));
      });
    const prompt = (text: string) => ({
      hook_event_name: "UserPromptSubmit",
      prompt: text,
    });
    const read = {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: image },
    };

    await record("refuse");
    const purged = await run(prompt(`deploy with ${SECRET}`));
    expect(purged.code).toBe(0);
    expect(purged.stdout).toContain("Prompt purgé avant envoi");
    expect(purged.stdout).not.toContain(SECRET);
    expect((await run(prompt(`deploy with ${SECRET}`), "block")).code).toBe(2);
    // Invisible characters are instructions, not secrets: they stay blocked.
    const tagged = `${SECRET} ${String.fromCodePoint(0xe0041, 0xe0042, 0xe0043)}`;
    expect((await run(prompt(tagged))).code).toBe(2);
    // An image stays blocked unless the user let screenshots through.
    expect((await run(read)).code).toBe(2);
    await record("allow");
    const screenshot = await run(read);
    expect(screenshot.code).toBe(0);
    expect(screenshot.stdout).toContain("captures d’écran autorisées");
  });
});
