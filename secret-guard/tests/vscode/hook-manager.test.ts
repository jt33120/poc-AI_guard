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

import {
  HookManager,
  isManagedHookConfig,
  quotePosix,
  quoteWindows,
  renderHookConfig,
} from "../../packages/vscode/src/hook-manager.js";

const HEALTHY_HOOK = [
  '"use strict";',
  "let input = '';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', chunk => { input += chunk; });",
  "process.stdin.on('end', () => {",
  "  const prompt = JSON.parse(input).prompt;",
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
  readonly executable: string;
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
    executable: process.execPath,
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

describe("hook configuration", () => {
  it("emits and recognizes only the exact canonical managed document", () => {
    const executable =
      "/Applications/Visual Studio Code.app/Contents/MacOS/Electron";
    const hookPath = "/tmp/a'b/hook.cjs";
    const content = renderHookConfig(executable, hookPath, "block");
    const parsed = JSON.parse(content) as {
      hooks: { UserPromptSubmit: Array<Record<string, unknown>> };
    };
    const hook = parsed.hooks.UserPromptSubmit[0]!;
    const posix = `${quotePosix(executable)} ${quotePosix(hookPath)} --warn=block`;
    const windows = `${quoteWindows(executable)} ${quoteWindows(hookPath)} --warn=block`;

    expect(hook).toMatchObject({
      type: "command",
      command: posix,
      linux: posix,
      osx: posix,
      windows,
      timeout: 30,
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        XSOM_SECRET_GUARD_MANAGED: "xsom-secret-guard-v0",
        XSOM_SECRET_GUARD_EXECUTABLE: executable,
        XSOM_SECRET_GUARD_HOOK: hookPath,
        XSOM_SECRET_GUARD_WARN_MODE: "block",
      },
    });
    expect(isManagedHookConfig(content, executable, hookPath)).toBe(true);
  });

  it("rejects malformed and foreign documents", () => {
    const executable = process.execPath;
    const hookPath = "/tmp/secret-guard/hook.cjs";
    expect(isManagedHookConfig("{", executable, hookPath)).toBe(false);
    expect(
      isManagedHookConfig(
        JSON.stringify({
          hooks: { UserPromptSubmit: [{ type: "command", command: "other" }] },
        }),
        executable,
        hookPath,
      ),
    ).toBe(false);
  });

  it("rejects executable substitution and malicious canonical lookalikes", () => {
    const executable = process.execPath;
    const hookPath = "/tmp/secret-guard/hook.cjs";
    const canonical = renderHookConfig(executable, hookPath, "block");
    const withExtraProperty = JSON.parse(canonical) as {
      hooks: { UserPromptSubmit: Array<Record<string, unknown>> };
    };
    withExtraProperty.hooks.UserPromptSubmit[0]!.unexpected = true;

    const lookalikes = [
      renderHookConfig("/tmp/attacker-runtime", hookPath, "block"),
      renderHookConfig(executable, "/tmp/attacker-hook.cjs", "block"),
      canonical.replace("xsom-secret-guard-v0", "xsom-secret-guard-v\u200b0"),
      canonical.replace(" --warn=block", " --warn=block && attacker"),
      canonical.replace('"timeout": 30', '"timeout": "30"'),
      JSON.stringify(withExtraProperty, null, 2),
      JSON.stringify(JSON.parse(canonical)),
      canonical.replace('{\n  "hooks": {', '{\n  "hooks": {},\n  "hooks": {'),
    ];

    for (const lookalike of lookalikes) {
      expect(isManagedHookConfig(lookalike, executable, hookPath)).toBe(false);
    }
  });

  it("escapes quotes without exposing shell interpolation", () => {
    expect(quotePosix("a'b$(touch /tmp/pwn)")).toBe(
      "'a'\"'\"'b$(touch /tmp/pwn)'",
    );
    expect(quoteWindows('a"b')).toBe('"a\\"b"');
  });
});

describe("transactional hook lifecycle", () => {
  it("installs only after two local canaries, refreshes, and removes idempotently", async () => {
    const { bundledHook, configPath, executable, installedHook, manager } =
      await fixture();

    await expect(manager.getHealth()).resolves.toEqual({
      state: "off",
      reason: "not_configured",
    });
    await expect(manager.enable("block")).resolves.toEqual({
      state: "preview",
      reason: "local_canary_verified",
    });
    expect(
      isManagedHookConfig(
        await readFile(configPath, "utf8"),
        executable,
        installedHook,
      ),
    ).toBe(true);
    await expect(readFile(installedHook)).resolves.toEqual(
      await readFile(bundledHook),
    );
    if (process.platform !== "win32") {
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    }

    await expect(manager.refreshIfConfigured("allow")).resolves.toEqual({
      state: "preview",
      reason: "local_canary_verified",
    });
    await expect(readFile(configPath, "utf8")).resolves.toBe(
      renderHookConfig(executable, installedHook, "allow"),
    );

    await manager.disable();
    await manager.disable();
    await expectMissing(installedHook);
    await expect(manager.getHealth()).resolves.toEqual({
      state: "off",
      reason: "not_configured",
    });
  }, 30_000);

  it("never overwrites, executes, refreshes, or deletes a foreign file", async () => {
    const { configPath, executable, installedHook, manager } = await fixture();
    const attackerExecutable = join(dirname(configPath), "attacker-runtime");
    const foreign = renderHookConfig(
      attackerExecutable,
      installedHook,
      "block",
    );
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, foreign, { mode: 0o600 });

    expect(isManagedHookConfig(foreign, executable, installedHook)).toBe(false);
    await expect(manager.getHealth()).resolves.toEqual({
      state: "degraded",
      reason: "foreign_config",
    });
    await expect(manager.refreshIfConfigured("allow")).resolves.toEqual({
      state: "degraded",
      reason: "foreign_config",
    });
    await expect(manager.enable("block")).rejects.toThrow(
      "refusing_to_overwrite_foreign_hook_config",
    );
    await expect(manager.disable()).rejects.toThrow(
      "refusing_to_delete_foreign_hook_config",
    );
    await expect(readFile(configPath, "utf8")).resolves.toBe(foreign);
  });

  it("reports a missing installed hook without executing anything", async () => {
    const { configPath, executable, installedHook, manager } = await fixture();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      renderHookConfig(executable, installedHook, "block"),
      { mode: 0o600 },
    );

    await expect(manager.getHealth()).resolves.toEqual({
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

    await expect(manager.getHealth()).resolves.toEqual({
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
