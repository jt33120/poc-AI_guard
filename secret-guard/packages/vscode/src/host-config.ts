import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

import type { WarnMode } from "@xsom/secret-guard-cli/hook";

export const MANAGED_MARKER = "xsom-secret-guard-v1";
export const HOST_HOOK_TIMEOUT_SECONDS = 30;

export type HookHost = "vscode" | "claude" | "codex" | "windsurf";
export type HookProtocol = "user-prompt-submit" | "windsurf";

export interface HostDefinition {
  readonly id: HookHost;
  readonly label: string;
  readonly configPath: string;
  readonly eventName: "UserPromptSubmit" | "pre_user_prompt";
  readonly format: "direct" | "nested" | "windsurf";
  readonly protocol: HookProtocol;
}

export function defaultHostDefinitions(
  home = homedir(),
): readonly HostDefinition[] {
  return [
    {
      id: "vscode",
      label: "VS Code / Copilot",
      configPath: join(home, ".copilot", "hooks", "xsom-secret-guard.json"),
      eventName: "UserPromptSubmit",
      format: "direct",
      protocol: "user-prompt-submit",
    },
    {
      id: "claude",
      label: "Claude Code",
      configPath: join(home, ".claude", "settings.json"),
      eventName: "UserPromptSubmit",
      format: "nested",
      protocol: "user-prompt-submit",
    },
    {
      id: "codex",
      label: "Codex",
      configPath: join(home, ".codex", "hooks.json"),
      eventName: "UserPromptSubmit",
      format: "nested",
      protocol: "user-prompt-submit",
    },
    {
      id: "windsurf",
      label: "Windsurf Cascade",
      configPath: join(home, ".codeium", "windsurf", "hooks.json"),
      eventName: "pre_user_prompt",
      format: "windsurf",
      protocol: "windsurf",
    },
  ];
}

export function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function renderPosixCommand(
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): string {
  return [
    "/usr/bin/env",
    quotePosix("ELECTRON_RUN_AS_NODE=1"),
    quotePosix(`XSOM_SECRET_GUARD_MANAGED=${MANAGED_MARKER}`),
    quotePosix(executable),
    quotePosix(hookPath),
    quotePosix(`--warn=${warnMode}`),
  ].join(" ");
}

export function renderPowerShellCommand(
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): string {
  const commandLine = [
    '"%XSOM_SECRET_GUARD_EXECUTABLE%"',
    '"%XSOM_SECRET_GUARD_HOOK%"',
    '"%XSOM_SECRET_GUARD_WARN_ARGUMENT%"',
  ].join(" ");
  return [
    "$env:ELECTRON_RUN_AS_NODE='1'",
    `$env:XSOM_SECRET_GUARD_MANAGED='${MANAGED_MARKER}'`,
    `$env:XSOM_SECRET_GUARD_EXECUTABLE=${quotePowerShell(executable)}`,
    `$env:XSOM_SECRET_GUARD_HOOK=${quotePowerShell(hookPath)}`,
    `$env:XSOM_SECRET_GUARD_WARN_ARGUMENT=${quotePowerShell(`--warn=${warnMode}`)}`,
    // Code.exe is a GUI-subsystem executable on Windows. PowerShell can run it
    // but does not reliably populate $LASTEXITCODE, so Codex cannot observe the
    // scanner's blocking exit code. cmd.exe is a console process and preserves
    // both inherited stdin and the child exit status.
    `& $env:ComSpec /d /v:off /s /c ${quotePowerShell(commandLine)}`,
    "exit $LASTEXITCODE",
  ].join("; ");
}

function renderLegacyPowerShellCommand(
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): string {
  return [
    "$env:ELECTRON_RUN_AS_NODE='1'",
    `$env:XSOM_SECRET_GUARD_MANAGED='${MANAGED_MARKER}'`,
    `& ${quotePowerShell(executable)} ${quotePowerShell(hookPath)} ${quotePowerShell(`--warn=${warnMode}`)}`,
    "exit $LASTEXITCODE",
  ].join("; ");
}

export function renderWindowsCommand(
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): string {
  const script = renderPowerShellCommand(executable, hookPath, warnMode);
  return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${script.replaceAll('"', '\\"')}"`;
}

function renderLegacyWindowsCommand(
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): string {
  const script = renderLegacyPowerShellCommand(executable, hookPath, warnMode);
  return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${script.replaceAll('"', '\\"')}"`;
}

function directEntry(
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): Record<string, unknown> {
  const command = renderPosixCommand(executable, hookPath, warnMode);
  return {
    type: "command",
    command,
    linux: command,
    osx: command,
    windows: renderWindowsCommand(executable, hookPath, warnMode),
    timeout: HOST_HOOK_TIMEOUT_SECONDS,
  };
}

function nestedEntry(
  host: HostDefinition,
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): Record<string, unknown> {
  const posix = renderPosixCommand(executable, hookPath, warnMode);
  const windows = renderWindowsCommand(executable, hookPath, warnMode);
  const handler: Record<string, unknown> = {
    type: "command",
    command:
      host.id === "claude" && process.platform === "win32" ? windows : posix,
    timeout: HOST_HOOK_TIMEOUT_SECONDS,
  };
  // Codex already evaluates commandWindows in PowerShell. A nested -Command
  // string expands $env and $LASTEXITCODE in the outer shell before execution.
  if (host.id === "codex")
    handler.commandWindows = renderPowerShellCommand(
      executable,
      hookPath,
      warnMode,
    );
  return { hooks: [handler] };
}

function windsurfEntry(
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): Record<string, unknown> {
  return {
    command: renderPosixCommand(executable, hookPath, warnMode),
    powershell: renderPowerShellCommand(executable, hookPath, warnMode),
  };
}

function managedEntry(
  host: HostDefinition,
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): Record<string, unknown> {
  if (host.format === "direct")
    return directEntry(executable, hookPath, warnMode);
  if (host.format === "windsurf")
    return windsurfEntry(executable, hookPath, warnMode);
  return nestedEntry(host, executable, hookPath, warnMode);
}

function legacyManagedEntry(
  host: HostDefinition,
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): Record<string, unknown> | null {
  if (host.format === "direct") {
    const command = renderPosixCommand(executable, hookPath, warnMode);
    return {
      type: "command",
      command,
      linux: command,
      osx: command,
      windows: renderPowerShellCommand(executable, hookPath, warnMode),
      timeout: HOST_HOOK_TIMEOUT_SECONDS,
    };
  }
  if (host.id === "codex") {
    return {
      hooks: [
        {
          type: "command",
          command: renderPosixCommand(executable, hookPath, warnMode),
          timeout: HOST_HOOK_TIMEOUT_SECONDS,
        },
      ],
    };
  }
  return null;
}

function legacyGuiExecutableEntry(
  host: HostDefinition,
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): Record<string, unknown> {
  const posix = renderPosixCommand(executable, hookPath, warnMode);
  const powershell = renderLegacyPowerShellCommand(
    executable,
    hookPath,
    warnMode,
  );
  if (host.format === "direct") {
    return {
      type: "command",
      command: posix,
      linux: posix,
      osx: posix,
      windows: renderLegacyWindowsCommand(executable, hookPath, warnMode),
      timeout: HOST_HOOK_TIMEOUT_SECONDS,
    };
  }
  if (host.format === "windsurf") {
    return { command: posix, powershell };
  }
  const handler: Record<string, unknown> = {
    type: "command",
    command:
      host.id === "claude" && process.platform === "win32"
        ? renderLegacyWindowsCommand(executable, hookPath, warnMode)
        : posix,
    timeout: HOST_HOOK_TIMEOUT_SECONDS,
  };
  if (host.id === "codex") handler.commandWindows = powershell;
  return { hooks: [handler] };
}

function legacyWindowsWrapperEntries(
  host: HostDefinition,
  hookPath: string,
): readonly Record<string, unknown>[] {
  if (host.id !== "claude" && host.id !== "codex") return [];
  const home = dirname(dirname(host.configPath));
  const runners = new Set([
    join(dirname(hookPath), "run-hook.cmd"),
    join(home, "AppData", "Local", "xsom-secret-guard", "run-hook.cmd"),
  ]);
  return [...runners].map((runner) => {
    const command = `${runner.replaceAll("\\", "/")} ; exit $LASTEXITCODE`;
    const handler: Record<string, unknown> = {
      type: "command",
      command,
      timeout: HOST_HOOK_TIMEOUT_SECONDS,
    };
    if (host.id === "codex") handler.commandWindows = command;
    return { hooks: [handler] };
  });
}

function legacyStandaloneEntries(
  host: HostDefinition,
): readonly Record<string, unknown>[] {
  if (host.id !== "codex" || process.platform !== "win32") return [];
  const home = dirname(dirname(host.configPath));
  const standaloneHook = join(
    home,
    "AppData",
    "Local",
    "xsom-secret-guard",
    "hook.cjs",
  );
  const roots = [
    process.env.ProgramFiles,
    process.env.ProgramW6432,
    process.env["ProgramFiles(x86)"],
  ].filter((root): root is string => root !== undefined && root.length > 0);
  const executables = new Set([
    ...roots.map((root) => join(root, "nodejs", "node.exe")),
    ...(process.env.LOCALAPPDATA
      ? [join(process.env.LOCALAPPDATA, "Programs", "nodejs", "node.exe")]
      : []),
  ]);
  return [...executables].flatMap((executable) =>
    (["block", "allow"] as const).flatMap((warnMode) => [
      managedEntry(host, executable, standaloneHook, warnMode),
      legacyGuiExecutableEntry(host, executable, standaloneHook, warnMode),
      {
        hooks: [
          {
            type: "command",
            command: renderPosixCommand(executable, standaloneHook, warnMode),
            commandWindows: renderWindowsCommand(
              executable,
              standaloneHook,
              warnMode,
            ),
            timeout: HOST_HOOK_TIMEOUT_SECONDS,
          },
        ],
      },
      {
        hooks: [
          {
            type: "command",
            command: renderPosixCommand(executable, standaloneHook, warnMode),
            commandWindows: renderLegacyWindowsCommand(
              executable,
              standaloneHook,
              warnMode,
            ),
            timeout: HOST_HOOK_TIMEOUT_SECONDS,
          },
        ],
      },
    ]),
  );
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  );
}

function canonical(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function containsMarker(value: unknown): boolean {
  if (typeof value === "string") return value.includes(MANAGED_MARKER);
  if (Array.isArray(value)) return value.some(containsMarker);
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some(containsMarker);
}

function parseRoot(content: string | null): Record<string, unknown> {
  if (content === null || content.trim() === "") return {};
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("invalid_host_config_root");
  return parsed as Record<string, unknown>;
}

function eventEntries(
  root: Record<string, unknown>,
  host: HostDefinition,
  create: boolean,
): unknown[] | null {
  let hooks = root.hooks;
  if (hooks === undefined && create) {
    hooks = {};
    root.hooks = hooks;
  }
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) {
    if (hooks === undefined) return null;
    throw new Error("invalid_host_hooks_config");
  }
  const hookMap = hooks as Record<string, unknown>;
  let entries = hookMap[host.eventName];
  if (entries === undefined && create) {
    entries = [];
    hookMap[host.eventName] = entries;
  }
  if (!Array.isArray(entries)) {
    if (entries === undefined) return null;
    throw new Error("invalid_host_event_config");
  }
  return entries;
}

function exactManagedEntry(
  value: unknown,
  host: HostDefinition,
  executable: string,
  hookPath: string,
): boolean {
  return (["block", "allow"] as const).some((warnMode) => {
    const current = managedEntry(host, executable, hookPath, warnMode);
    const legacy = legacyManagedEntry(host, executable, hookPath, warnMode);
    const legacyGuiExecutable = legacyGuiExecutableEntry(
      host,
      executable,
      hookPath,
      warnMode,
    );
    const wrappers = legacyWindowsWrapperEntries(host, hookPath);
    const standalone = legacyStandaloneEntries(host);
    const nestedPowerShell =
      host.id === "codex"
        ? {
            hooks: [
              {
                type: "command",
                command: renderPosixCommand(executable, hookPath, warnMode),
                commandWindows: renderWindowsCommand(
                  executable,
                  hookPath,
                  warnMode,
                ),
                timeout: HOST_HOOK_TIMEOUT_SECONDS,
              },
            ],
          }
        : null;
    const legacyNestedPowerShell =
      host.id === "codex"
        ? {
            hooks: [
              {
                type: "command",
                command: renderPosixCommand(executable, hookPath, warnMode),
                commandWindows: renderLegacyWindowsCommand(
                  executable,
                  hookPath,
                  warnMode,
                ),
                timeout: HOST_HOOK_TIMEOUT_SECONDS,
              },
            ],
          }
        : null;
    return (
      canonical(value) === canonical(current) ||
      (legacy !== null && canonical(value) === canonical(legacy)) ||
      canonical(value) === canonical(legacyGuiExecutable) ||
      (nestedPowerShell !== null &&
        canonical(value) === canonical(nestedPowerShell)) ||
      (legacyNestedPowerShell !== null &&
        canonical(value) === canonical(legacyNestedPowerShell)) ||
      wrappers.some((wrapper) => canonical(value) === canonical(wrapper)) ||
      standalone.some((entry) => canonical(value) === canonical(entry))
    );
  });
}

export type HostConfigState = "off" | "configured" | "degraded";

export function inspectHostConfig(
  content: string | null,
  host: HostDefinition,
  executable: string,
  hookPath: string,
): HostConfigState {
  if (content === null) return "off";
  try {
    const entries = eventEntries(parseRoot(content), host, false);
    if (entries === null) return "off";
    const exact = entries.filter((entry) =>
      exactManagedEntry(entry, host, executable, hookPath),
    );
    const marked = entries.filter(containsMarker);
    const foreignMarked = marked.some(
      (entry) => !exactManagedEntry(entry, host, executable, hookPath),
    );
    if (foreignMarked) return "degraded";
    if (exact.length === 1) return "configured";
    return marked.length === 0 ? "off" : "degraded";
  } catch {
    return "degraded";
  }
}

export function configureHost(
  content: string | null,
  host: HostDefinition,
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): string {
  const root = parseRoot(content);
  const entries = eventEntries(root, host, true);
  if (entries === null) throw new Error("invalid_host_event_config");
  const foreignMarked = entries.some(
    (entry) =>
      containsMarker(entry) &&
      !exactManagedEntry(entry, host, executable, hookPath),
  );
  if (foreignMarked) throw new Error("refusing_to_replace_unrecognized_guard");
  const retained = entries.filter(
    (entry) => !exactManagedEntry(entry, host, executable, hookPath),
  );
  retained.push(managedEntry(host, executable, hookPath, warnMode));
  (root.hooks as Record<string, unknown>)[host.eventName] = retained;
  return `${JSON.stringify(root, null, 2)}\n`;
}

function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

export function unconfigureHost(
  content: string | null,
  host: HostDefinition,
  executable: string,
  hookPath: string,
): string | null {
  if (content === null) return null;
  const root = parseRoot(content);
  const entries = eventEntries(root, host, false);
  if (entries === null) return content;
  const foreignMarked = entries.some(
    (entry) =>
      containsMarker(entry) &&
      !exactManagedEntry(entry, host, executable, hookPath),
  );
  if (foreignMarked) throw new Error("refusing_to_remove_unrecognized_guard");
  const retained = entries.filter(
    (entry) => !exactManagedEntry(entry, host, executable, hookPath),
  );
  const hooks = root.hooks as Record<string, unknown>;
  if (retained.length === 0) Reflect.deleteProperty(hooks, host.eventName);
  else hooks[host.eventName] = retained;
  if (isEmptyObject(hooks)) delete root.hooks;
  return isEmptyObject(root) ? null : `${JSON.stringify(root, null, 2)}\n`;
}
