import { homedir } from "node:os";
import { join } from "node:path";
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
  if (host.id === "codex") handler.commandWindows = windows;
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

function canonical(value: unknown): string {
  return JSON.stringify(value);
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
    return (
      canonical(value) === canonical(current) ||
      (legacy !== null && canonical(value) === canonical(legacy))
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
    if (exact.length === 1 && marked.length === 1) return "configured";
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
