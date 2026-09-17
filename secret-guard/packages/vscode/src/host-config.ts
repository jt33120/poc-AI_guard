import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

import { hookModeArgument, type WarnMode } from "@xsom/secret-guard-cli/hook";

export const MANAGED_MARKER = "xsom-secret-guard-v1";
export const HOST_HOOK_TIMEOUT_SECONDS = 30;

export type HookHost = "vscode" | "claude" | "codex";
export type HookProtocol = "user-prompt-submit";

export interface HostDefinition {
  readonly id: HookHost;
  readonly label: string;
  readonly configPath: string;
  readonly eventName: "UserPromptSubmit";
  readonly format: "direct" | "nested";
  readonly protocol: HookProtocol;
  // Also runs the hook before the host's Read tool hands a file to the model.
  readonly guardsFileReads?: true;
}

export const FILE_READ_EVENT = "PreToolUse";
export const FILE_READ_MATCHER = "Read";

export function defaultHostDefinitions(
  home = homedir(),
): readonly HostDefinition[] {
  return [
    {
      id: "vscode",
      label: "GitHub Copilot",
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
      guardsFileReads: true,
    },
    {
      id: "codex",
      label: "Codex",
      configPath: join(home, ".codex", "hooks.json"),
      eventName: "UserPromptSubmit",
      format: "nested",
      protocol: "user-prompt-submit",
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
    quotePosix(hookModeArgument(warnMode)),
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
    `$env:XSOM_SECRET_GUARD_WARN_ARGUMENT=${quotePowerShell(hookModeArgument(warnMode))}`,
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

export function renderClaudeWindowsCommand(
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): string {
  const script = renderPowerShellCommand(executable, hookPath, warnMode);
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  // Claude Code runs Windows hooks through PowerShell. Passing another
  // double-quoted -Command makes the outer shell expand $env:* and
  // $LASTEXITCODE before the scanner starts. -EncodedCommand avoids that
  // expansion; the final exit propagates the scanner's blocking code 2.
  return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}; exit $LASTEXITCODE # ${MANAGED_MARKER}`;
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

// Claude Code shows this text with its spinner while the hook runs, so a
// check of about a second does not look like a frozen assistant.
export const CLAUDE_STATUS_MESSAGES = {
  prompt: "Secret Guard · vérification du message…",
  fileRead: "Secret Guard · vérification du fichier…",
} as const;

function nestedEntry(
  host: HostDefinition,
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
  statusMessage?: string,
): Record<string, unknown> {
  const posix = renderPosixCommand(executable, hookPath, warnMode);
  const handler: Record<string, unknown> = {
    type: "command",
    command:
      host.id === "claude" && process.platform === "win32"
        ? renderClaudeWindowsCommand(executable, hookPath, warnMode)
        : posix,
    timeout: HOST_HOOK_TIMEOUT_SECONDS,
  };
  if (host.id === "claude" && statusMessage !== undefined)
    handler.statusMessage = statusMessage;
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

function managedEntry(
  host: HostDefinition,
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): Record<string, unknown> {
  if (host.format === "direct")
    return directEntry(executable, hookPath, warnMode);
  return nestedEntry(
    host,
    executable,
    hookPath,
    warnMode,
    CLAUDE_STATUS_MESSAGES.prompt,
  );
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
  eventName: string,
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
  let entries = hookMap[eventName];
  if (entries === undefined && create) {
    entries = [];
    hookMap[eventName] = entries;
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
  return (["block", "allow", "redact", "observe"] as const).some((warnMode) => {
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
    const legacyClaudeNestedPowerShell =
      host.id === "claude" && process.platform === "win32"
        ? {
            hooks: [
              {
                type: "command",
                command: renderWindowsCommand(executable, hookPath, warnMode),
                timeout: HOST_HOOK_TIMEOUT_SECONDS,
              },
            ],
          }
        : null;
    // 0.4.3 installed the current Claude command without a status message.
    const claudeWithoutStatus =
      host.id === "claude"
        ? nestedEntry(host, executable, hookPath, warnMode)
        : null;
    return (
      canonical(value) === canonical(current) ||
      (claudeWithoutStatus !== null &&
        canonical(value) === canonical(claudeWithoutStatus)) ||
      (legacy !== null && canonical(value) === canonical(legacy)) ||
      canonical(value) === canonical(legacyGuiExecutable) ||
      (nestedPowerShell !== null &&
        canonical(value) === canonical(nestedPowerShell)) ||
      (legacyNestedPowerShell !== null &&
        canonical(value) === canonical(legacyNestedPowerShell)) ||
      (legacyClaudeNestedPowerShell !== null &&
        canonical(value) === canonical(legacyClaudeNestedPowerShell)) ||
      wrappers.some((wrapper) => canonical(value) === canonical(wrapper)) ||
      standalone.some((entry) => canonical(value) === canonical(entry))
    );
  });
}

function readGuardEntry(
  host: HostDefinition,
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
  statusMessage: string | null = CLAUDE_STATUS_MESSAGES.fileRead,
): Record<string, unknown> {
  return {
    matcher: FILE_READ_MATCHER,
    ...nestedEntry(
      host,
      executable,
      hookPath,
      warnMode,
      statusMessage ?? undefined,
    ),
  };
}

function exactReadGuardEntry(
  value: unknown,
  host: HostDefinition,
  executable: string,
  hookPath: string,
): boolean {
  return (["block", "allow", "redact", "observe"] as const).some(
    (warnMode) =>
      canonical(value) ===
        canonical(readGuardEntry(host, executable, hookPath, warnMode)) ||
      canonical(value) ===
        canonical(readGuardEntry(host, executable, hookPath, warnMode, null)),
  );
}

type EntryMatcher = (entry: unknown) => boolean;

interface ManagedEvent {
  readonly eventName: string;
  readonly isManaged: EntryMatcher;
  readonly entry: (warnMode: WarnMode) => Record<string, unknown>;
}

function managedEvents(
  host: HostDefinition,
  executable: string,
  hookPath: string,
): readonly ManagedEvent[] {
  const prompt: ManagedEvent = {
    eventName: host.eventName,
    isManaged: (entry) => exactManagedEntry(entry, host, executable, hookPath),
    entry: (warnMode) => managedEntry(host, executable, hookPath, warnMode),
  };
  if (host.guardsFileReads !== true) return [prompt];
  return [
    prompt,
    {
      eventName: FILE_READ_EVENT,
      isManaged: (entry) =>
        exactReadGuardEntry(entry, host, executable, hookPath),
      entry: (warnMode) => readGuardEntry(host, executable, hookPath, warnMode),
    },
  ];
}

// "outdated": the prompt guard is installed but a newer guard (file reads) is
// not yet; refreshing the configuration completes it.
export type HostConfigState = "off" | "configured" | "outdated" | "degraded";

type EventState = "off" | "configured" | "degraded";

function inspectEvent(
  root: Record<string, unknown>,
  event: ManagedEvent,
): EventState {
  const entries = eventEntries(root, event.eventName, false);
  if (entries === null) return "off";
  const marked = entries.filter(containsMarker);
  if (marked.some((entry) => !event.isManaged(entry))) return "degraded";
  if (entries.filter(event.isManaged).length === 1) return "configured";
  return marked.length === 0 ? "off" : "degraded";
}

export function inspectHostConfig(
  content: string | null,
  host: HostDefinition,
  executable: string,
  hookPath: string,
): HostConfigState {
  if (content === null) return "off";
  try {
    const root = parseRoot(content);
    const [prompt, ...others] = managedEvents(host, executable, hookPath).map(
      (event) => inspectEvent(root, event),
    );
    const states = [prompt, ...others];
    if (states.includes("degraded")) return "degraded";
    if (states.every((state) => state === "configured")) return "configured";
    if (prompt === "configured") return "outdated";
    return states.every((state) => state === "off") ? "off" : "degraded";
  } catch {
    return "degraded";
  }
}

function foreignMarked(
  entries: readonly unknown[],
  event: ManagedEvent,
): boolean {
  return entries.some(
    (entry) => containsMarker(entry) && !event.isManaged(entry),
  );
}

export function configureHost(
  content: string | null,
  host: HostDefinition,
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): string {
  const root = parseRoot(content);
  const events = managedEvents(host, executable, hookPath);
  const updates = events.map((event) => {
    const entries = eventEntries(root, event.eventName, true);
    if (entries === null) throw new Error("invalid_host_event_config");
    if (foreignMarked(entries, event))
      throw new Error("refusing_to_replace_unrecognized_guard");
    return { event, entries };
  });
  for (const { event, entries } of updates) {
    const retained = entries.filter((entry) => !event.isManaged(entry));
    retained.push(event.entry(warnMode));
    (root.hooks as Record<string, unknown>)[event.eventName] = retained;
  }
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
  const updates = managedEvents(host, executable, hookPath).flatMap((event) => {
    const entries = eventEntries(root, event.eventName, false);
    if (entries === null) return [];
    if (foreignMarked(entries, event))
      throw new Error("refusing_to_remove_unrecognized_guard");
    return [{ event, entries }];
  });
  if (updates.length === 0) return content;
  const hooks = root.hooks as Record<string, unknown>;
  for (const { event, entries } of updates) {
    const retained = entries.filter((entry) => !event.isManaged(entry));
    if (retained.length === 0) Reflect.deleteProperty(hooks, event.eventName);
    else hooks[event.eventName] = retained;
  }
  if (isEmptyObject(hooks)) delete root.hooks;
  return isEmptyObject(root) ? null : `${JSON.stringify(root, null, 2)}\n`;
}
