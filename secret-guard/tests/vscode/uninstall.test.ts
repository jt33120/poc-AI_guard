import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  configureHost,
  defaultHostDefinitions,
  removeMarkedHooks,
} from "../../packages/vscode/src/host-config.js";
import {
  extensionRemoved,
  recordInstallation,
  removeManagedHooks,
} from "../../packages/vscode/src/uninstall.js";

const EXTENSION_ID = "xsom.xsom-secret-guard-vscode";
// Assembled at run time so the dogfood scan of this file stays clean.
const GITHUB_TOKEN = ["ghp", "aB3d".repeat(9)].join("_");
const OTHER_TOOL = {
  hooks: [{ type: "command", command: "node other-tool.cjs prompt" }],
};

let root: string;
let home: string;
let storage: string;
let extensionsDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "secret-guard-uninstall-"));
  home = join(root, "home");
  storage = join(root, "globalStorage", EXTENSION_ID);
  extensionsDir = join(root, "extensions");
  await mkdir(storage, { recursive: true });
  await mkdir(extensionsDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeManifest(ids: readonly string[]): Promise<void> {
  await writeFile(
    join(extensionsDir, "extensions.json"),
    JSON.stringify(ids.map((id) => ({ identifier: { id }, version: "0.8.1" }))),
  );
}

describe("removeMarkedHooks", () => {
  const [, claude] = defaultHostDefinitions("/home/dev");

  it("keeps the other tools' hooks and drops only Secret Guard's", () => {
    const configured = configureHost(
      JSON.stringify({ hooks: { UserPromptSubmit: [OTHER_TOOL] }, model: "x" }),
      claude!,
      "/usr/bin/code",
      "/storage/hook.cjs",
      "redact",
    );
    const cleaned = JSON.parse(removeMarkedHooks(configured)!) as unknown;
    expect(cleaned).toEqual({
      hooks: { UserPromptSubmit: [OTHER_TOOL] },
      model: "x",
    });
  });

  it("deletes a file it alone filled", () => {
    const configured = configureHost(
      null,
      claude!,
      "/usr/bin/code",
      "/storage/hook.cjs",
      "block",
    );
    expect(removeMarkedHooks(configured)).toBeNull();
  });

  it("leaves a file without Secret Guard byte for byte", () => {
    const content = '{"hooks":{"Stop":[]}}';
    expect(removeMarkedHooks(content)).toBe(content);
    expect(removeMarkedHooks(null)).toBeNull();
  });
});

describe("extensionRemoved", () => {
  it("is true only when VS Code's index no longer lists the extension", async () => {
    await recordInstallation(storage, {
      extensionId: EXTENSION_ID,
      extensionsDir,
    });
    await writeManifest(["other.tool", "XSOM.xsom-secret-guard-vscode"]);
    expect(await extensionRemoved(storage)).toBe(false);
    await writeManifest(["other.tool"]);
    expect(await extensionRemoved(storage)).toBe(true);
  });

  it("keeps the guard on whenever removal is not proven", async () => {
    // No record: an install older than this check, or a damaged storage.
    await writeManifest([]);
    expect(await extensionRemoved(storage)).toBe(false);
    // A development install has no index next to it.
    await recordInstallation(storage, {
      extensionId: EXTENSION_ID,
      extensionsDir: join(root, "packages"),
    });
    expect(await extensionRemoved(storage)).toBe(false);
    // An index caught mid-write or replaced by something else.
    await recordInstallation(storage, {
      extensionId: EXTENSION_ID,
      extensionsDir,
    });
    await writeFile(join(extensionsDir, "extensions.json"), "[{");
    expect(await extensionRemoved(storage)).toBe(false);
    await writeFile(join(extensionsDir, "extensions.json"), "{}");
    expect(await extensionRemoved(storage)).toBe(false);
  });
});

describe("removeManagedHooks", () => {
  it("cleans every assistant and skips a file it cannot read", async () => {
    const hosts = defaultHostDefinitions(home);
    for (const host of hosts) {
      await mkdir(join(host.configPath, ".."), { recursive: true });
      await writeFile(
        host.configPath,
        configureHost(
          null,
          host,
          "/usr/bin/code",
          "/storage/hook.cjs",
          "block",
        ),
      );
    }
    const [copilot, claude, codex] = hosts;
    await writeFile(codex!.configPath, "not json");
    await removeManagedHooks(hosts);
    expect(existsSync(copilot!.configPath)).toBe(false);
    expect(existsSync(claude!.configPath)).toBe(false);
    expect(await readFile(codex!.configPath, "utf8")).toBe("not json");
  });
});

describe("the installed hook after an uninstall", () => {
  const hook = buildSync({
    entryPoints: [resolve("packages/vscode/src/hook-entry.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    define: {
      __XSOM_RULES_AUTHORITY_KEYS__: JSON.stringify(""),
      __XSOM_RUNNER_VERSION__: JSON.stringify("0.8.1"),
    },
    alias: {
      "@xsom/secret-guard-cli/hook": resolve("packages/cli/src/hook.ts"),
      "@xsom/secret-guard-core": resolve("packages/core/src/index.ts"),
      "@xsom/developer-guard-runner": resolve("packages/runner/src/index.ts"),
      "@xsom/developer-guard-policy": resolve("packages/policy/src/index.ts"),
      "@xsom/developer-guard-adapters": resolve(
        "packages/adapters/src/index.ts",
      ),
    },
  }).outputFiles[0]!.contents;

  async function install(): Promise<{ hookPath: string; settings: string }> {
    const hookPath = join(storage, "hook.cjs");
    await writeFile(hookPath, hook);
    await recordInstallation(storage, {
      extensionId: EXTENSION_ID,
      extensionsDir,
    });
    const [, claude] = defaultHostDefinitions(home);
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(
      claude!.configPath,
      configureHost(
        JSON.stringify({ hooks: { UserPromptSubmit: [OTHER_TOOL] } }),
        claude!,
        process.execPath,
        hookPath,
        "block",
      ),
    );
    return { hookPath, settings: claude!.configPath };
  }

  function submit(hookPath: string) {
    const environment = { ...process.env };
    delete environment.CLAUDE_PROJECT_DIR;
    return spawnSync(
      process.execPath,
      [hookPath, "--host=claude", "--mode=block"],
      {
        encoding: "utf8",
        env: {
          ...environment,
          ELECTRON_RUN_AS_NODE: "1",
          HOME: home,
          USERPROFILE: home,
        },
        input: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          prompt: `deploy ${GITHUB_TOKEN}`,
        }),
        timeout: 20_000,
      },
    );
  }

  it("keeps blocking while the extension is installed", async () => {
    const { hookPath, settings } = await install();
    await writeManifest([EXTENSION_ID]);
    const before = await readFile(settings, "utf8");
    expect(submit(hookPath).status).toBe(2);
    expect(await readFile(settings, "utf8")).toBe(before);
    expect(existsSync(hookPath)).toBe(true);
  });

  it("unhooks itself, lets the prompt through and deletes its file", async () => {
    const { hookPath, settings } = await install();
    await writeManifest(["other.tool"]);
    const result = submit(hookPath);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ continue: true });
    expect(JSON.parse(await readFile(settings, "utf8"))).toEqual({
      hooks: { UserPromptSubmit: [OTHER_TOOL] },
    });
    expect(existsSync(hookPath)).toBe(false);
  });
});
