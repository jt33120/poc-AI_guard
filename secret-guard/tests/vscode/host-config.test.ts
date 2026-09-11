import { describe, expect, it } from "vitest";

import {
  configureHost,
  defaultHostDefinitions,
  inspectHostConfig,
  MANAGED_MARKER,
  renderPosixCommand,
  renderPowerShellCommand,
  renderWindowsCommand,
  unconfigureHost,
} from "../../packages/vscode/src/host-config.js";

const executable = "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const hookPath = "/tmp/xsom secret-guard/hook.cjs";

describe("multi-host hook configuration", () => {
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
    expect(renderWindowsCommand("C:\\guard.exe", hookPath, "block")).toMatch(
      /^powershell -NoProfile -NonInteractive /,
    );
  });

  for (const host of defaultHostDefinitions("/tmp/home")) {
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
      expect(refreshed).toContain("--warn=allow");
      expect(refreshed).not.toContain("--warn=block");

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
      expect(upgraded).toContain("powershell -NoProfile -NonInteractive");
    }
  });
});
