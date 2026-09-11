import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

import { afterEach, describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { defaultHostDefinitions } from "../../packages/vscode/src/host-config.js";
import { HookManager } from "../../packages/vscode/src/hook-manager.js";

const HEALTHY_HOOK = [
  '"use strict";',
  "let input = '';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', chunk => { input += chunk; });",
  "process.stdin.on('end', () => {",
  "  const parsed = JSON.parse(input);",
  "  const prompt = parsed.prompt ?? parsed.tool_info?.user_prompt;",
  "  if (prompt.includes('ghp_')) {",
  "    process.stderr.write('Secret Guard blocked this prompt.\\n');",
  "    process.exitCode = 2;",
  "  } else {",
  "    process.stdout.write('{\"continue\":true}\\n');",
  "  }",
  "});",
].join("\n");

const NON_BLOCKING_HOOK = [
  '"use strict";',
  "process.stdin.resume();",
  "process.stdin.on('end', () => {",
  "  process.stdout.write('{\"continue\":true}\\n');",
  "});",
].join("\n");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (path) => rm(path, { recursive: true, force: true })),
  );
});

interface HookFixture {
  readonly bundledHook: string;
  readonly configPath: string;
  readonly installedHook: string;
  readonly manager: HookManager;
}

async function fixture(hookSource = HEALTHY_HOOK): Promise<HookFixture> {
  const root = await mkdtemp(join(tmpdir(), "secret-guard-hook-manager-"));
  temporaryDirectories.push(root);
  const extensionRoot = join(root, "extension");
  const storageRoot = join(root, "storage");
  const configPath = join(root, "home", ".copilot", "hooks", "guard.json");
  const bundledHook = join(extensionRoot, "dist", "hook.cjs");
  const installedHook = join(storageRoot, "hook.cjs");
  await mkdir(dirname(bundledHook), { recursive: true });
  await writeFile(bundledHook, hookSource, { mode: 0o600 });
  const context = {
    extensionUri: { fsPath: extensionRoot },
    globalStorageUri: { fsPath: storageRoot },
  } as unknown as vscode.ExtensionContext;
  return {
    bundledHook,
    configPath,
    installedHook,
    manager: new HookManager(context, {
      configPath,
      executable: process.execPath,
    }),
  };
}

async function expectMissing(path: string): Promise<void> {
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("transactional hook lifecycle", () => {
  it("installs only after local canaries, refreshes, and removes idempotently", async () => {
    const { bundledHook, configPath, installedHook, manager } = await fixture();

    await expect(manager.getHealth()).resolves.toMatchObject({
      state: "off",
      reason: "not_configured",
    });
    await expect(manager.enable("block")).resolves.toMatchObject({
      state: "active",
      reason: "local_canaries_verified",
    });
    expect(await readFile(configPath, "utf8")).toContain(
      "xsom-secret-guard-v1",
    );
    await expect(readFile(installedHook)).resolves.toEqual(
      await readFile(bundledHook),
    );
    if (process.platform !== "win32") {
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    }

    await expect(manager.refreshIfConfigured("allow")).resolves.toMatchObject({
      state: "active",
    });
    expect(await readFile(configPath, "utf8")).toContain("--warn=allow");

    await manager.disable();
    await manager.disable();
    await expectMissing(configPath);
    await expectMissing(installedHook);
    await expect(manager.getHealth()).resolves.toMatchObject({ state: "off" });
  }, 30_000);

  it("preserves foreign settings and hooks through enable and disable", async () => {
    const { configPath, manager } = await fixture();
    const foreign = `${JSON.stringify(
      {
        editorSetting: true,
        hooks: {
          UserPromptSubmit: [{ type: "command", command: "foreign" }],
          Stop: [{ type: "command", command: "keep-stop" }],
        },
      },
      null,
      2,
    )}\n`;
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, foreign, { mode: 0o600 });

    await manager.enable("block");
    const configured = await readFile(configPath, "utf8");
    expect(configured).toContain("foreign");
    expect(configured).toContain("keep-stop");
    expect(configured).toContain("xsom-secret-guard-v1");

    await manager.disable();
    const restored = JSON.parse(await readFile(configPath, "utf8")) as {
      editorSetting: boolean;
      hooks: Record<string, unknown[]>;
    };
    expect(restored.editorSetting).toBe(true);
    expect(restored.hooks.UserPromptSubmit).toEqual([
      { type: "command", command: "foreign" },
    ]);
    expect(restored.hooks.Stop).toEqual([
      { type: "command", command: "keep-stop" },
    ]);
  });

  it("configures all native host protocols in one transaction", async () => {
    const root = await mkdtemp(join(tmpdir(), "secret-guard-multi-host-"));
    temporaryDirectories.push(root);
    const extensionRoot = join(root, "extension");
    const storageRoot = join(root, "storage");
    const bundledHook = join(extensionRoot, "dist", "hook.cjs");
    await mkdir(dirname(bundledHook), { recursive: true });
    await writeFile(bundledHook, HEALTHY_HOOK, { mode: 0o600 });
    const context = {
      extensionUri: { fsPath: extensionRoot },
      globalStorageUri: { fsPath: storageRoot },
    } as unknown as vscode.ExtensionContext;
    const hosts = defaultHostDefinitions(join(root, "home"));
    const manager = new HookManager(context, {
      executable: process.execPath,
      hosts,
    });

    const health = await manager.enable("block");
    expect(health.state).toBe("active");
    expect(health.hosts).toHaveLength(4);
    expect(health.hosts.every((host) => host.configured)).toBe(true);
    for (const host of hosts) {
      expect(await readFile(host.configPath, "utf8")).toContain(
        "xsom-secret-guard-v1",
      );
    }
  }, 30_000);

  it("reports a missing installed hook without executing anything", async () => {
    const { installedHook, manager } = await fixture();
    await manager.enable("block");
    await rm(installedHook);
    await expect(manager.getHealth()).resolves.toMatchObject({
      state: "degraded",
      reason: "hook_missing",
    });
  });

  it("does not execute an installed hook whose bytes differ from the bundle", async () => {
    const { installedHook, manager } = await fixture();
    const executionMarker = `${installedHook}.executed`;
    await manager.enable("block");
    await writeFile(
      installedHook,
      [
        `require("node:fs").writeFileSync(${JSON.stringify(executionMarker)}, "executed");`,
        NON_BLOCKING_HOOK,
      ].join("\n"),
      { mode: 0o600 },
    );

    await expect(manager.getHealth()).resolves.toMatchObject({
      state: "degraded",
      reason: "hook_modified",
    });
    await expectMissing(executionMarker);
  });

  it("rolls back the candidate when either canary contract fails", async () => {
    const { configPath, installedHook, manager } =
      await fixture(NON_BLOCKING_HOOK);

    await expect(manager.enable("block")).rejects.toThrow("hook_canary_failed");
    await expectMissing(configPath);
    await expectMissing(installedHook);
    await expectMissing(`${installedHook}.${process.pid}.candidate`);
  });
});
