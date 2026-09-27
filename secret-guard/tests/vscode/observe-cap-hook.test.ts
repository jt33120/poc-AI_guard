import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalizePolicyPayload } from "../../packages/runner/src/index.js";

// The real hook runner, bundled like the release, run as the subprocess an
// assistant starts while VS Code is closed: nothing but the files in its
// storage folder tells it the mode, the window and the organization's cap.
const RUNNER = "0.7.1";
const MINUTE = 60 * 1000;
// Assembled at run time so the dogfood scan of this file stays clean.
const GITHUB_TOKEN = ["ghp", "aB3d".repeat(9)].join("_");

const hook = buildSync({
  entryPoints: [resolve("packages/vscode/src/hook-entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  define: {
    __XSOM_RULES_AUTHORITY_KEYS__: JSON.stringify(""),
    __XSOM_RUNNER_VERSION__: JSON.stringify(RUNNER),
  },
  alias: {
    "@xsom/secret-guard-cli/hook": resolve("packages/cli/src/hook.ts"),
    "@xsom/secret-guard-core": resolve("packages/core/src/index.ts"),
    "@xsom/developer-guard-runner": resolve("packages/runner/src/index.ts"),
    "@xsom/developer-guard-policy": resolve("packages/policy/src/index.ts"),
    "@xsom/developer-guard-adapters": resolve("packages/adapters/src/index.ts"),
  },
}).outputFiles[0]!.contents;

const keys = generateKeyPairSync("ed25519");
const pinned = Buffer.from(
  (keys.publicKey.export({ format: "jwk" }) as { x: string }).x,
  "base64url",
).toString("base64");

function envelope(
  extra: Record<string, unknown>,
  privateKey: KeyObject = keys.privateKey,
) {
  // Prompts are left to the scanner: the only effect under test is the cap.
  const policy = {
    schemaVersion: 1,
    tenantId: "tenant-a",
    policyId: "equipe",
    version: 1,
    issuedAt: "2026-09-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
    minRunnerVersion: RUNNER,
    defaults: { unknownAction: "allow" },
    rules: [],
    ...extra,
  };
  return {
    policy,
    keyId: "test",
    publicKey: pinned,
    signature: sign(
      null,
      Buffer.from(canonicalizePolicyPayload(policy)),
      privateKey,
    ).toString("base64"),
  };
}

let storage: string;
beforeAll(async () => {
  storage = await mkdtemp(join(tmpdir(), "observe-cap-hook-"));
  await writeFile(join(storage, "hook.cjs"), hook);
});
afterAll(async () => {
  await rm(storage, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const file of [
    "developer-policy.json",
    "developer-policy.pub",
    "observe-until",
  ])
    await rm(join(storage, file), { force: true });
});

async function state(
  windowMinutes: number,
  policy?: unknown,
  key = pinned,
): Promise<void> {
  await writeFile(
    join(storage, "observe-until"),
    String(Date.now() + windowMinutes * MINUTE),
  );
  if (policy === undefined) return;
  await writeFile(join(storage, "developer-policy.pub"), `${key}\n`);
  await writeFile(
    join(storage, "developer-policy.json"),
    JSON.stringify(policy),
  );
}

/** "observe" when the secret is let through with a warning, else "stopped". */
function secretPrompt(): "observe" | "stopped" {
  // Outside a Claude session: the stale-session hint must not interfere.
  const environment = { ...process.env };
  delete environment.CLAUDE_PROJECT_DIR;
  const result = spawnSync(
    process.execPath,
    [join(storage, "hook.cjs"), "--host=claude", "--mode=observe"],
    {
      encoding: "utf8",
      env: { ...environment, ELECTRON_RUN_AS_NODE: "1" },
      input: JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        prompt: `deploy ${GITHUB_TOKEN}`,
      }),
      timeout: 20_000,
    },
  );
  expect(result.stdout + result.stderr).not.toContain(GITHUB_TOKEN);
  if (result.status === 0) {
    const response = JSON.parse(result.stdout) as {
      continue?: unknown;
      systemMessage?: unknown;
    };
    expect(response.continue).toBe(true);
    expect(typeof response.systemMessage).toBe("string");
    return "observe";
  }
  expect(result.status).toBe(2);
  return "stopped";
}

describe("the hook enforces the organization's cap on Avertir by itself", () => {
  it("lets Avertir run without a policy, up to eight hours", async () => {
    await state(60);
    expect(secretPrompt()).toBe("observe");
    await state(9 * 60);
    expect(secretPrompt()).toBe("stopped");
  });

  it("applies Expurger when the organization forbids Avertir", async () => {
    await state(15, envelope({ workstation: { observeMaxMinutes: 0 } }));
    expect(secretPrompt()).toBe("stopped");
  });

  it("applies Expurger while more time is left than the cap allows", async () => {
    const capped = envelope({ workstation: { observeMaxMinutes: 60 } });
    await state(4 * 60, capped);
    expect(secretPrompt()).toBe("stopped");
    await state(30, capped);
    expect(secretPrompt()).toBe("observe");
    await state(
      15,
      envelope({ workstation: { observeMaxMinutes: 15 }, version: 2 }),
    );
    expect(secretPrompt()).toBe("observe");
  });

  it("keeps the 8-hour ceiling under a verified policy without a cap", async () => {
    await state(4 * 60, envelope({}));
    expect(secretPrompt()).toBe("observe");
  });

  it("never lets an unverified policy loosen anything", async () => {
    // Cap raised by hand from 0 to 480: the signature fails, the managed
    // workstation refuses instead of warning.
    const edited = envelope({ workstation: { observeMaxMinutes: 0 } });
    edited.policy = {
      ...edited.policy,
      workstation: { observeMaxMinutes: 480 },
    };
    await state(60, edited);
    expect(secretPrompt()).toBe("stopped");
    // Signed by another key than the pinned one.
    const stranger = generateKeyPairSync("ed25519");
    await state(
      60,
      envelope(
        { workstation: { observeMaxMinutes: 480 } },
        stranger.privateKey,
      ),
    );
    expect(secretPrompt()).toBe("stopped");
    // The policy removed while its pinned key stays.
    await state(60, envelope({ workstation: { observeMaxMinutes: 0 } }));
    await rm(join(storage, "developer-policy.json"));
    expect(secretPrompt()).toBe("stopped");
  });

  it("refuses a policy written for a newer runner instead of ignoring it", async () => {
    await state(
      60,
      envelope({
        minRunnerVersion: "9.0.0",
        workstation: { observeMaxMinutes: 480 },
      }),
    );
    expect(secretPrompt()).toBe("stopped");
  });
});
