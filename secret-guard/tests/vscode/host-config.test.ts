import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildSync } from "esbuild";

import {
  CLAUDE_STATUS_MESSAGES,
  configureHost,
  defaultHostDefinitions,
  inspectHostConfig,
  MANAGED_MARKER,
  renderClaudeWindowsCommand,
  renderPosixCommand,
  renderPowerShellCommand,
  renderWindowsCommand,
  unconfigureHost,
} from "../../packages/vscode/src/host-config.js";

const executable = "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const hookPath = "/tmp/xsom secret-guard/hook.cjs";

function legacyPowerShellCommand(
  executablePath: string,
  installedHook: string,
): string {
  return [
    "$env:ELECTRON_RUN_AS_NODE='1'",
    `$env:XSOM_SECRET_GUARD_MANAGED='${MANAGED_MARKER}'`,
    `& '${executablePath.replaceAll("'", "''")}' '${installedHook.replaceAll("'", "''")}' '--warn=block'`,
    "exit $LASTEXITCODE",
  ].join("; ");
}

function legacyNestedPowerShellCommand(
  executablePath: string,
  installedHook: string,
): string {
  const script = legacyPowerShellCommand(executablePath, installedHook);
  return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${script.replaceAll('"', '\\"')}"`;
}

describe("multi-host hook configuration", () => {
  it("targets only GitHub Copilot, Claude Code and Codex", () => {
    expect(
      defaultHostDefinitions("/tmp/home").map(({ id, label }) => ({
        id,
        label,
      })),
    ).toEqual([
      { id: "vscode", label: "GitHub Copilot" },
      { id: "claude", label: "Claude Code" },
      { id: "codex", label: "Codex" },
    ]);
  });

  it("renders injection-safe commands with an ownership marker", () => {
    const posix = renderPosixCommand(
      "/tmp/a'b$(touch /tmp/pwn)",
      hookPath,
      "block",
    );
    expect(posix).toContain(`XSOM_SECRET_GUARD_MANAGED=${MANAGED_MARKER}`);
    expect(posix).toContain("'/tmp/a'\"'\"'b$(touch /tmp/pwn)'");
    expect(posix).toContain("'--warn=block'");

    const powershell = renderPowerShellCommand(
      "C:\\a'b.exe",
      hookPath,
      "allow",
    );
    expect(powershell).toContain("C:\\a''b.exe");
    expect(powershell).toContain("--warn=allow");
    expect(powershell).toContain("& $env:ComSpec /d /v:off /s /c");
    expect(powershell).toContain('"%XSOM_SECRET_GUARD_EXECUTABLE%"');
    expect(renderWindowsCommand("C:\\guard.exe", hookPath, "block")).toMatch(
      /^powershell -NoProfile -NonInteractive /,
    );
    const claudeWindows = renderClaudeWindowsCommand(
      "C:\\guard.exe",
      hookPath,
      "block",
    );
    expect(claudeWindows).toContain("-EncodedCommand");
    expect(claudeWindows).toContain("exit $LASTEXITCODE");
    expect(claudeWindows).toContain(MANAGED_MARKER);
    expect(claudeWindows).not.toContain("C:\\guard.exe");
  });

  for (const host of defaultHostDefinitions("/tmp/home")) {
    it(`switches modes reversibly for ${host.id} without duplicating hooks`, () => {
      let content: string | null = null;
      for (const mode of [
        "block",
        "observe",
        "redact",
        "allow",
        "block",
      ] as const) {
        content = configureHost(content, host, executable, hookPath, mode);
        expect(inspectHostConfig(content, host, executable, hookPath)).toBe(
          "configured",
        );
        const parsed = JSON.parse(content) as {
          hooks: Record<string, unknown[]>;
        };
        expect(parsed.hooks[host.eventName]).toHaveLength(1);
      }
      expect(unconfigureHost(content, host, executable, hookPath)).toBeNull();
    });

    it(`adds, refreshes, and removes only the ${host.id} entry`, () => {
      const foreign = {
        otherSetting: true,
        hooks: {
          [host.eventName]: [{ command: "foreign-command" }],
          Stop: [{ command: "keep-me" }],
        },
      };
      const configured = configureHost(
        JSON.stringify(foreign),
        host,
        executable,
        hookPath,
        "block",
      );
      expect(inspectHostConfig(configured, host, executable, hookPath)).toBe(
        "configured",
      );
      expect(configured).toContain("foreign-command");
      expect(configured).toContain("keep-me");

      const refreshed = configureHost(
        configured,
        host,
        executable,
        hookPath,
        "allow",
      );
      expect(inspectHostConfig(refreshed, host, executable, hookPath)).toBe(
        "configured",
      );
      if (host.id === "claude" && process.platform === "win32") {
        expect(refreshed).toContain(
          renderClaudeWindowsCommand(executable, hookPath, "allow"),
        );
        expect(refreshed).not.toContain(
          renderClaudeWindowsCommand(executable, hookPath, "block"),
        );
      } else {
        expect(refreshed).toContain("--warn=allow");
        expect(refreshed).not.toContain("--warn=block");
      }

      const removed = unconfigureHost(refreshed, host, executable, hookPath);
      expect(removed).not.toBeNull();
      expect(removed).toContain("foreign-command");
      expect(removed).toContain("keep-me");
      expect(removed).not.toContain(MANAGED_MARKER);
      expect(inspectHostConfig(removed, host, executable, hookPath)).toBe(
        "off",
      );
    });

    it(`creates and fully removes an owned ${host.id} document`, () => {
      const configured = configureHost(
        null,
        host,
        executable,
        hookPath,
        "block",
      );
      expect(inspectHostConfig(configured, host, executable, hookPath)).toBe(
        "configured",
      );
      expect(
        unconfigureHost(configured, host, executable, hookPath),
      ).toBeNull();
    });
  }

  it("fails closed on malformed config and forged ownership markers", () => {
    const host = defaultHostDefinitions("/tmp/home")[1]!;
    const forged = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: `echo ${MANAGED_MARKER}`,
                timeout: 30,
              },
            ],
          },
        ],
      },
    });
    expect(inspectHostConfig("{", host, executable, hookPath)).toBe("degraded");
    expect(inspectHostConfig(forged, host, executable, hookPath)).toBe(
      "degraded",
    );
    expect(() =>
      configureHost(forged, host, executable, hookPath, "block"),
    ).toThrow("refusing_to_replace_unrecognized_guard");
    expect(() => unconfigureHost(forged, host, executable, hookPath)).toThrow(
      "refusing_to_remove_unrecognized_guard",
    );
  });

  it("recognizes and upgrades the pre-release v1 command shapes", () => {
    const hosts = defaultHostDefinitions("/tmp/home");
    for (const host of [hosts[0]!, hosts[2]!]) {
      const configured = JSON.parse(
        configureHost(null, host, executable, hookPath, "block"),
      ) as { hooks: Record<string, Array<Record<string, unknown>>> };
      const entry = configured.hooks[host.eventName]![0]!;
      if (host.id === "vscode") {
        entry.windows = renderPowerShellCommand(executable, hookPath, "block");
      } else {
        const handler = (entry.hooks as Array<Record<string, unknown>>)[0]!;
        Reflect.deleteProperty(handler, "commandWindows");
      }
      const legacy = JSON.stringify(configured);
      expect(inspectHostConfig(legacy, host, executable, hookPath)).toBe(
        "configured",
      );

      const upgraded = configureHost(
        legacy,
        host,
        executable,
        hookPath,
        "block",
      );
      expect(inspectHostConfig(upgraded, host, executable, hookPath)).toBe(
        "configured",
      );
      expect(upgraded).toContain("exit $LASTEXITCODE");
    }
  });

  it.each(["claude", "codex"] as const)(
    "recognizes and upgrades the old Windows wrapper for %s",
    (hostId) => {
      const host = defaultHostDefinitions("C:\\Users\\tester").find(
        (candidate) => candidate.id === hostId,
      )!;
      const windowsExecutable = "C:\\Program Files\\nodejs\\node.exe";
      const windowsHook =
        "C:\\Users\\tester\\AppData\\Roaming\\Code\\User\\globalStorage\\xsom.xsom-secret-guard-vscode\\hook.cjs";
      const wrapper =
        "C:/Users/tester/AppData/Local/xsom-secret-guard/run-hook.cmd ; exit $LASTEXITCODE";
      const handler: Record<string, unknown> =
        hostId === "codex"
          ? {
              type: "command",
              command: wrapper,
              commandWindows: wrapper,
              timeout: 30,
            }
          : {
              type: "command",
              command: wrapper,
              timeout: 30,
            };
      const oldConfig = JSON.stringify({
        hooks: { UserPromptSubmit: [{ hooks: [handler] }] },
      });

      // Claude also guards file reads now: an old prompt-only entry is kept
      // recognizable but reported for refresh.
      expect(
        inspectHostConfig(oldConfig, host, windowsExecutable, windowsHook),
      ).toBe(hostId === "claude" ? "outdated" : "configured");

      const upgraded = configureHost(
        oldConfig,
        host,
        windowsExecutable,
        windowsHook,
        "block",
      );
      expect(upgraded).not.toContain("run-hook.cmd");
      expect(upgraded).toContain(MANAGED_MARKER);
      if (hostId === "codex" || process.platform === "win32") {
        expect(upgraded).toContain("exit $LASTEXITCODE");
      } else {
        expect(upgraded).toContain("/usr/bin/env");
      }
      expect(
        inspectHostConfig(upgraded, host, windowsExecutable, windowsHook),
      ).toBe("configured");
    },
  );

  it.skipIf(process.platform !== "win32")(
    "recognizes and upgrades Claude's double-expanded v0.2.2 command",
    () => {
      const host = defaultHostDefinitions()[1]!;
      const oldCommand = renderWindowsCommand(executable, hookPath, "block");
      const oldConfig = JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [{ type: "command", command: oldCommand, timeout: 30 }],
            },
          ],
        },
      });

      expect(inspectHostConfig(oldConfig, host, executable, hookPath)).toBe(
        "outdated",
      );
      const upgraded = configureHost(
        oldConfig,
        host,
        executable,
        hookPath,
        "block",
      );
      expect(upgraded).not.toContain(oldCommand);
      expect(upgraded).toContain(
        renderClaudeWindowsCommand(executable, hookPath, "block"),
      );
    },
  );

  it("migrates the nested PowerShell Codex command while preserving other hooks", () => {
    const host = defaultHostDefinitions()[2]!;
    const old = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "foreign-command" }] },
          {
            hooks: [
              {
                type: "command",
                command: renderPosixCommand(executable, hookPath, "block"),
                commandWindows: legacyNestedPowerShellCommand(
                  executable,
                  hookPath,
                ),
                timeout: 30,
              },
            ],
          },
        ],
      },
    });
    const upgraded = configureHost(old, host, executable, hookPath, "block");
    const parsed = JSON.parse(upgraded);
    expect(parsed.hooks.UserPromptSubmit).toHaveLength(2);
    expect(upgraded).toContain("foreign-command");
    expect(parsed.hooks.UserPromptSubmit[1].hooks[0].commandWindows).toBe(
      renderPowerShellCommand(executable, hookPath, "block"),
    );
    expect(configureHost(upgraded, host, executable, hookPath, "block")).toBe(
      upgraded,
    );
  });

  it.skipIf(process.platform !== "win32" || !process.env.ProgramFiles)(
    "migrates the repaired standalone Codex hook into extension storage",
    () => {
      const home = "C:\\Users\\tester";
      const host = defaultHostDefinitions(home)[2]!;
      const standaloneExecutable = join(
        process.env.ProgramFiles!,
        "nodejs",
        "node.exe",
      );
      const standaloneHook = join(
        home,
        "AppData",
        "Local",
        "xsom-secret-guard",
        "hook.cjs",
      );
      const extensionExecutable =
        "C:\\Users\\tester\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe";
      const extensionHook =
        "C:\\Users\\tester\\AppData\\Roaming\\Code\\User\\globalStorage\\xsom.xsom-secret-guard-vscode\\hook.cjs";
      const old = JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: "command",
                  command: renderPosixCommand(
                    standaloneExecutable,
                    standaloneHook,
                    "block",
                  ),
                  commandWindows: legacyPowerShellCommand(
                    standaloneExecutable,
                    standaloneHook,
                  ),
                  timeout: 30,
                },
              ],
            },
          ],
        },
      });

      expect(
        inspectHostConfig(old, host, extensionExecutable, extensionHook),
      ).toBe("configured");
      const upgraded = configureHost(
        old,
        host,
        extensionExecutable,
        extensionHook,
        "block",
      );
      expect(upgraded).not.toContain(standaloneHook.replaceAll("\\", "\\\\"));
      expect(upgraded).toContain(extensionHook.replaceAll("\\", "\\\\"));
      expect(
        inspectHostConfig(upgraded, host, extensionExecutable, extensionHook),
      ).toBe("configured");
    },
  );

  it.skipIf(process.platform !== "win32")(
    "preserves the scanner verdict through Claude's outer PowerShell",
    () => {
      const host = defaultHostDefinitions()[1]!;
      const directory = mkdtempSync(join(tmpdir(), "secret-guard-claude-"));
      const bundle = join(directory, "hook ' $guard.cjs");
      try {
        const built = buildSync({
          entryPoints: [resolve("packages/vscode/src/hook-entry.ts")],
          bundle: true,
          platform: "node",
          format: "cjs",
          write: false,
          alias: {
            "@xsom/secret-guard-cli/hook": resolve("packages/cli/src/hook.ts"),
            "@xsom/secret-guard-core": resolve("packages/core/src/index.ts"),
          },
        });
        writeFileSync(bundle, built.outputFiles[0]!.contents);
        const config = JSON.parse(
          configureHost(null, host, process.execPath, bundle, "block"),
        );
        const command = config.hooks.UserPromptSubmit[0].hooks[0].command;
        for (const [prompt, expected] of [
          ["Bonjour", 0],
          [
            "Analyse cette configuration : PASSWORD=definitely-not-a-real-secret-123",
            2,
          ],
        ] as const) {
          const result = spawnSync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", command],
            {
              input: JSON.stringify({
                hook_event_name: "UserPromptSubmit",
                prompt,
              }),
              encoding: "utf8",
              timeout: 10_000,
              windowsHide: true,
            },
          );
          expect(result.error).toBeUndefined();
          expect(result.status, result.stderr).toBe(expected);
          if (expected === 2) {
            expect(result.stderr).toContain("Secret Guard detected password");
            expect(result.stderr).not.toContain(
              "definitely-not-a-real-secret-123",
            );
          } else expect(JSON.parse(result.stdout)).toEqual({ continue: true });
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform !== "win32")(
    "preserves the scanner verdict through the actual Codex PowerShell command",
    () => {
      const host = defaultHostDefinitions()[2]!;
      // Build from source: a clean checkout must not need a pre-existing dist.
      const directory = mkdtempSync(join(tmpdir(), "secret-guard-codex-"));
      const bundle = join(directory, "hook ' $guard.cjs");
      try {
        const built = buildSync({
          entryPoints: [resolve("packages/vscode/src/hook-entry.ts")],
          bundle: true,
          platform: "node",
          format: "cjs",
          write: false,
          alias: {
            "@xsom/secret-guard-cli/hook": resolve("packages/cli/src/hook.ts"),
            "@xsom/secret-guard-core": resolve("packages/core/src/index.ts"),
          },
        });
        writeFileSync(bundle, built.outputFiles[0]!.contents);
        const config = JSON.parse(
          configureHost(null, host, process.execPath, bundle, "block"),
        );
        const command =
          config.hooks.UserPromptSubmit[0].hooks[0].commandWindows;
        for (const [prompt, expected] of [
          ["Bonjour", 0],
          [
            "Analyse cette configuration : PASSWORD=definitely-not-a-real-secret-123",
            2,
          ],
          ["password : qjwmzptrkaflx", 2],
        ] as const) {
          const result = spawnSync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", command],
            {
              input: JSON.stringify({
                hook_event_name: "UserPromptSubmit",
                prompt,
              }),
              encoding: "utf8",
              timeout: 10_000,
              windowsHide: true,
            },
          );
          expect(result.error).toBeUndefined();
          expect(result.status, result.stderr).toBe(expected);
          if (expected === 2) {
            expect(result.stderr).toContain("Secret Guard detected password");
            expect(result.stderr).not.toContain(
              "definitely-not-a-real-secret-123",
            );
          } else expect(JSON.parse(result.stdout)).toEqual({ continue: true });
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    25_000,
  );
  it("guards Claude file reads with a Read matcher next to the prompt hook", () => {
    const host = defaultHostDefinitions().find(
      (candidate) => candidate.id === "claude",
    )!;
    const foreign = {
      matcher: "Bash",
      hooks: [{ type: "command", command: "lint" }],
    };
    const configured = configureHost(
      JSON.stringify({ hooks: { PreToolUse: [foreign] } }),
      host,
      executable,
      hookPath,
      "redact",
    );
    const parsed = JSON.parse(configured) as {
      hooks: Record<string, Array<{ matcher?: string }>>;
    };
    expect(parsed.hooks.UserPromptSubmit).toHaveLength(1);
    expect(parsed.hooks.PreToolUse).toHaveLength(2);
    expect(parsed.hooks.PreToolUse?.[0]).toEqual(foreign);
    expect(parsed.hooks.PreToolUse?.[1]?.matcher).toBe("Read");
    expect(inspectHostConfig(configured, host, executable, hookPath)).toBe(
      "configured",
    );

    const promptOnly = JSON.parse(configured) as {
      hooks: Record<string, unknown[]>;
    };
    promptOnly.hooks.PreToolUse = [foreign];
    expect(
      inspectHostConfig(JSON.stringify(promptOnly), host, executable, hookPath),
    ).toBe("outdated");

    const removed = unconfigureHost(configured, host, executable, hookPath);
    expect(JSON.parse(removed!)).toEqual({ hooks: { PreToolUse: [foreign] } });
  });

  it("keeps file-read guards away from hosts without a Read tool contract", () => {
    for (const host of defaultHostDefinitions().filter(
      (candidate) => candidate.id !== "claude",
    )) {
      const configured = configureHost(
        null,
        host,
        executable,
        hookPath,
        "block",
      );
      expect(configured).not.toContain("PreToolUse");
    }
  });

  it("refuses to replace a forged file-read guard", () => {
    const host = defaultHostDefinitions().find(
      (candidate) => candidate.id === "claude",
    )!;
    const forged = JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Read",
            hooks: [{ type: "command", command: `evil ${MANAGED_MARKER}` }],
          },
        ],
      },
    });
    expect(inspectHostConfig(forged, host, executable, hookPath)).toBe(
      "degraded",
    );
    expect(() =>
      configureHost(forged, host, executable, hookPath, "block"),
    ).toThrow("refusing_to_replace_unrecognized_guard");
  });
  it("gives Claude hooks a status message and upgrades 0.4.3 entries without one", () => {
    const hosts = defaultHostDefinitions();
    const claude = hosts.find((candidate) => candidate.id === "claude")!;
    const configured = JSON.parse(
      configureHost(null, claude, executable, hookPath, "block"),
    ) as {
      hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>>;
    };
    expect(
      configured.hooks.UserPromptSubmit?.[0]?.hooks[0]?.statusMessage,
    ).toBe(CLAUDE_STATUS_MESSAGES.prompt);
    expect(configured.hooks.PreToolUse?.[0]?.hooks[0]?.statusMessage).toBe(
      CLAUDE_STATUS_MESSAGES.fileRead,
    );

    const withoutStatus = structuredClone(configured);
    for (const entries of Object.values(withoutStatus.hooks))
      for (const entry of entries) delete entry.hooks[0]!.statusMessage;
    const old = JSON.stringify(withoutStatus);
    expect(inspectHostConfig(old, claude, executable, hookPath)).toBe(
      "configured",
    );
    expect(configureHost(old, claude, executable, hookPath, "block")).toContain(
      CLAUDE_STATUS_MESSAGES.fileRead,
    );

    const codex = hosts.find((candidate) => candidate.id === "codex")!;
    expect(
      configureHost(null, codex, executable, hookPath, "block"),
    ).not.toContain("statusMessage");
  });
});
