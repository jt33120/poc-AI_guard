import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EMPTY_RULES_PACK_STATE,
  rulesPackPath,
  writeRulesPackState,
} from "../../packages/runner/src/index.js";
import { startGatewayBridge } from "../../packages/vscode/src/gateway-bridge.js";
import { routeFile } from "../../packages/vscode/src/gateway-delegation.js";

// The real hook runner, bundled like the release (esbuild `define`), run as
// the subprocess an assistant starts. It must verify the stored pack itself.
const vectors = JSON.parse(
  readFileSync(
    new URL(
      "../../contracts/fixtures/rules-pack-vectors.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  signature: {
    publicKeyBase64: string;
    envelope: { payload: Record<string, unknown> };
  };
};
const TENANT = "00000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "CLI-00421337";
// Assembled at run time so the dogfood scan of this file stays clean.
const GITHUB_TOKEN = ["ghp", "aB3d".repeat(9)].join("_");

function bundle(keys: string): Uint8Array {
  const built = buildSync({
    entryPoints: [resolve("packages/vscode/src/hook-entry.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    define: { __XSOM_RULES_AUTHORITY_KEYS__: JSON.stringify(keys) },
    alias: {
      "@xsom/secret-guard-cli/hook": resolve("packages/cli/src/hook.ts"),
      "@xsom/secret-guard-core": resolve("packages/core/src/index.ts"),
      "@xsom/developer-guard-runner": resolve("packages/runner/src/index.ts"),
      "@xsom/developer-guard-policy": resolve("packages/policy/src/index.ts"),
      "@xsom/developer-guard-adapters": resolve(
        "packages/adapters/src/index.ts",
      ),
    },
  });
  return built.outputFiles[0]!.contents;
}

let storage: string;
const withKey = bundle(vectors.signature.publicKeyBase64);
const withoutKey = bundle("");

beforeAll(async () => {
  storage = await mkdtemp(join(tmpdir(), "rules-hook-"));
  await writeFile(
    rulesPackPath(storage),
    JSON.stringify(vectors.signature.envelope),
  );
  await writeRulesPackState(storage, {
    ...EMPTY_RULES_PACK_STATE,
    tenantId: TENANT,
    tenantSource: "register",
  });
});

afterAll(async () => {
  await rm(storage, { recursive: true, force: true });
});

async function runHook(
  hook: Uint8Array,
  prompt: string,
  mode = "block",
  environment: Record<string, string> = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const path = join(storage, "hook.cjs");
  await writeFile(path, hook);
  // Asynchronous: a relay served by this test process must keep answering.
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path, "--host=claude", `--mode=${mode}`],
      {
        env: { ...process.env, ...environment, ELECTRON_RUN_AS_NODE: "1" },
        timeout: 20_000,
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
    child.stdin.end(
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt }),
    );
  });
}

describe("hook runner with an xSOM rules pack", () => {
  it("blocks a custom detection by its label, never by its value", async () => {
    const result = await runHook(withKey, `Le client ${CUSTOMER_ID} a appelé.`);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "« Identifiant client ACME » (réglage xSOM)",
    );
    expect(result.stderr + result.stdout).not.toContain(CUSTOMER_ID);
    expect(result.stderr + result.stdout).not.toContain("00421337");
  });

  it("lets a clean prompt through", async () => {
    const result = await runHook(withKey, "Explique cette fonction.");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ continue: true });
  });

  it("refuses the pack in a build without authority key, built-in rules intact", async () => {
    const custom = await runHook(withoutKey, `Le client ${CUSTOMER_ID}.`);
    expect(custom.status).toBe(0);
    const builtIn = await runHook(withoutKey, `deploy ${GITHUB_TOKEN}`);
    expect(builtIn.status).toBe(2);
    expect(builtIn.stderr).not.toContain(GITHUB_TOKEN);
  });

  it("re-verifies the stored file: an edited pack is ignored", async () => {
    const tampered = structuredClone(vectors.signature.envelope);
    tampered.payload.tenantId = "tenant-b";
    await writeFile(rulesPackPath(storage), JSON.stringify(tampered));
    try {
      const result = await runHook(withKey, `Le client ${CUSTOMER_ID}.`);
      expect(result.status).toBe(0);
    } finally {
      await writeFile(
        rulesPackPath(storage),
        JSON.stringify(vectors.signature.envelope),
      );
    }
  });

  it("never delegates a custom detection to the relay, which cannot clean it", async () => {
    // A live local relay in Expurger: built-in secrets are delegated to it
    // (it cleans them), a customer id of the xSOM tuning stays blocked.
    const upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const relay = await startGatewayBridge(
      `http://127.0.0.1:${String((upstream.address() as AddressInfo).port)}`,
      "synthetic-gateway-token",
    );
    try {
      await writeFile(
        routeFile(storage, relay.baseUrl),
        JSON.stringify({ baseUrl: relay.baseUrl }),
      );
      const environment = { ANTHROPIC_BASE_URL: relay.baseUrl };
      const builtIn = await runHook(
        withKey,
        `deploy ${GITHUB_TOKEN}`,
        "redact",
        environment,
      );
      expect(builtIn.status).toBe(0);
      const custom = await runHook(
        withKey,
        `Le client ${CUSTOMER_ID} a appelé.`,
        "redact",
        environment,
      );
      expect(custom.status).toBe(2);
      expect(custom.stderr).toContain("« Identifiant client ACME »");
      expect(custom.stderr).not.toContain("nouvelle session");
      expect(custom.stderr).not.toContain(CUSTOMER_ID);
      // Too many customer ids for the scanner to keep: incomplete, and an
      // incomplete scan with a tuning loaded is never delegated either.
      const dump = Array.from(
        { length: 2_100 },
        (_, index) => `CLI-${String(10_000_000 + index)}`,
      ).join(" ");
      const incomplete = await runHook(withKey, dump, "redact", environment);
      expect(incomplete.status).toBe(2);
      expect(incomplete.stderr).toContain("analyse incomplète");
    } finally {
      await relay.close();
      upstream.closeAllConnections();
      upstream.close();
    }
  });
});
