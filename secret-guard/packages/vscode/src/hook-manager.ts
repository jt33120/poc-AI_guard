import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

import type * as vscode from "vscode";

import type { WarnMode } from "@xsom/secret-guard-cli/hook";

const DEFAULT_HOOK_CONFIG_PATH = join(
  homedir(),
  ".copilot",
  "hooks",
  "xsom-secret-guard.json",
);
const CANARY_TIMEOUT_MS = 5_000;
const HOST_HOOK_TIMEOUT_SECONDS = 30;
const MAX_CANARY_OUTPUT_BYTES = 64 * 1024;
const MANAGED_MARKER = "xsom-secret-guard-v0";

export type HookHealthState = "off" | "preview" | "degraded";

export interface HookHealth {
  readonly state: HookHealthState;
  readonly reason:
    | "not_configured"
    | "local_canary_verified"
    | "foreign_config"
    | "hook_missing"
    | "hook_modified"
    | "canary_failed";
}

export interface HookManagerOptions {
  readonly configPath?: string;
  readonly executable?: string;
}

interface HookExecution {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function quoteWindows(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

export function renderHookConfig(
  executable: string,
  hookPath: string,
  warnMode: WarnMode,
): string {
  const args = ` --warn=${warnMode}`;
  const posix = `${quotePosix(executable)} ${quotePosix(hookPath)}${args}`;
  const windows = `${quoteWindows(executable)} ${quoteWindows(hookPath)}${args}`;
  return `${JSON.stringify(
    {
      hooks: {
        UserPromptSubmit: [
          {
            type: "command",
            command: posix,
            linux: posix,
            osx: posix,
            windows,
            timeout: HOST_HOOK_TIMEOUT_SECONDS,
            env: {
              ELECTRON_RUN_AS_NODE: "1",
              XSOM_SECRET_GUARD_MANAGED: MANAGED_MARKER,
              XSOM_SECRET_GUARD_EXECUTABLE: executable,
              XSOM_SECRET_GUARD_HOOK: hookPath,
              XSOM_SECRET_GUARD_WARN_MODE: warnMode,
            },
          },
        ],
      },
    },
    null,
    2,
  )}\n`;
}

interface ManagedHookConfig {
  readonly warnMode: WarnMode;
}

function parseManagedHookConfig(
  content: string,
  expectedExecutable: string,
  expectedHookPath: string,
): ManagedHookConfig | null {
  try {
    const parsed = JSON.parse(content) as {
      hooks?: { UserPromptSubmit?: unknown };
    };
    const hooks = parsed.hooks?.UserPromptSubmit;
    if (!Array.isArray(hooks) || hooks.length !== 1) return null;
    const candidate = hooks[0] as Record<string, unknown> | undefined;
    if (candidate === undefined || candidate.type !== "command") return null;
    const env = candidate.env as Record<string, unknown> | undefined;
    const executable = env?.XSOM_SECRET_GUARD_EXECUTABLE;
    const hookPath = env?.XSOM_SECRET_GUARD_HOOK;
    const warnMode = env?.XSOM_SECRET_GUARD_WARN_MODE;
    if (
      env?.ELECTRON_RUN_AS_NODE !== "1" ||
      env.XSOM_SECRET_GUARD_MANAGED !== MANAGED_MARKER ||
      executable !== expectedExecutable ||
      hookPath !== expectedHookPath ||
      (warnMode !== "allow" && warnMode !== "block") ||
      candidate.timeout !== HOST_HOOK_TIMEOUT_SECONDS
    ) {
      return null;
    }
    return content ===
      renderHookConfig(expectedExecutable, expectedHookPath, warnMode)
      ? { warnMode }
      : null;
  } catch {
    return null;
  }
}

export function isManagedHookConfig(
  content: string,
  expectedExecutable: string,
  expectedHookPath: string,
): boolean {
  return (
    parseManagedHookConfig(content, expectedExecutable, expectedHookPath) !==
    null
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

async function filesMatch(left: string, right: string): Promise<boolean> {
  const [leftMetadata, rightMetadata] = await Promise.all([
    stat(left),
    stat(right),
  ]);
  if (leftMetadata.size !== rightMetadata.size) return false;
  const [leftContent, rightContent] = await Promise.all([
    readFile(left),
    readFile(right),
  ]);
  return leftContent.equals(rightContent);
}

async function writeAtomically(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await rm(temporary, { force: true });
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function executeHook(
  executable: string,
  hookPath: string,
  prompt: string,
): Promise<HookExecution> {
  return new Promise((resolve) => {
    const child = spawn(executable, [hookPath, "--warn=block"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      finish(null);
    }, CANARY_TIMEOUT_MS);
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    };
    const capture = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString("utf8")}`.slice(0, MAX_CANARY_OUTPUT_BYTES);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = capture(stdout, chunk);
      if (stdout.length >= MAX_CANARY_OUTPUT_BYTES) child.kill();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = capture(stderr, chunk);
      if (stderr.length >= MAX_CANARY_OUTPUT_BYTES) child.kill();
    });
    child.once("error", () => {
      finish(null);
    });
    child.once("close", (code) => {
      finish(code);
    });
    child.stdin.once("error", () => {
      // A rejected hook can close stdin before the complete canary is written.
    });
    child.stdin.end(
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt }),
    );
  });
}

export async function verifyHookCanary(
  executable: string,
  hookPath: string,
): Promise<boolean> {
  const SYNTHETIC_CANARY = `ghp_${"Sg7".repeat(12)}`;
  const clean = await executeHook(
    executable,
    hookPath,
    "Explain this local function.",
  );
  const blocked = await executeHook(
    executable,
    hookPath,
    `Review candidate ${SYNTHETIC_CANARY}`,
  );

  let cleanResponse: unknown;
  try {
    cleanResponse = JSON.parse(clean.stdout);
  } catch {
    return false;
  }
  const cleanAllowed =
    typeof cleanResponse === "object" &&
    cleanResponse !== null &&
    "continue" in cleanResponse &&
    cleanResponse.continue === true &&
    Object.keys(cleanResponse).length === 1;
  const output = `${clean.stdout}${clean.stderr}${blocked.stdout}${blocked.stderr}`;
  return (
    clean.exitCode === 0 &&
    !clean.timedOut &&
    clean.stderr === "" &&
    cleanAllowed &&
    blocked.exitCode === 2 &&
    !blocked.timedOut &&
    blocked.stdout === "" &&
    blocked.stderr.length > 0 &&
    !output.includes(SYNTHETIC_CANARY)
  );
}

export class HookManager {
  private readonly bundledHook: string;
  private readonly installedHook: string;
  private readonly configPath: string;
  private readonly executable: string;

  public constructor(
    context: vscode.ExtensionContext,
    options: HookManagerOptions = {},
  ) {
    this.bundledHook = join(context.extensionUri.fsPath, "dist", "hook.cjs");
    this.installedHook = join(context.globalStorageUri.fsPath, "hook.cjs");
    this.configPath = options.configPath ?? DEFAULT_HOOK_CONFIG_PATH;
    this.executable = options.executable ?? process.execPath;
  }

  public async getHealth(): Promise<HookHealth> {
    const config = await readOptional(this.configPath);
    if (config === null) return { state: "off", reason: "not_configured" };
    const managed = parseManagedHookConfig(
      config,
      this.executable,
      this.installedHook,
    );
    if (managed === null)
      return { state: "degraded", reason: "foreign_config" };
    if (!(await pathExists(this.installedHook)))
      return { state: "degraded", reason: "hook_missing" };
    if (
      !(await pathExists(this.bundledHook)) ||
      !(await filesMatch(this.bundledHook, this.installedHook))
    ) {
      return { state: "degraded", reason: "hook_modified" };
    }
    return (await verifyHookCanary(this.executable, this.installedHook))
      ? { state: "preview", reason: "local_canary_verified" }
      : { state: "degraded", reason: "canary_failed" };
  }

  public async isConfigured(): Promise<boolean> {
    return (await this.getHealth()).state === "preview";
  }

  public async enable(warnMode: WarnMode): Promise<HookHealth> {
    const previousConfig = await readOptional(this.configPath);
    if (
      previousConfig !== null &&
      !isManagedHookConfig(previousConfig, this.executable, this.installedHook)
    ) {
      throw new Error("refusing_to_overwrite_foreign_hook_config");
    }

    const candidate = `${this.installedHook}.${process.pid}.candidate`;
    await mkdir(dirname(this.installedHook), { recursive: true });
    await rm(candidate, { force: true });
    await copyFile(this.bundledHook, candidate);
    if (!(await verifyHookCanary(this.executable, candidate))) {
      await rm(candidate, { force: true });
      throw new Error("hook_canary_failed");
    }
    await rename(candidate, this.installedHook);

    try {
      await writeAtomically(
        this.configPath,
        renderHookConfig(this.executable, this.installedHook, warnMode),
      );
    } catch (error) {
      if (previousConfig === null) {
        await rm(this.configPath, { force: true });
        await rm(this.installedHook, { force: true });
      } else {
        await writeAtomically(this.configPath, previousConfig);
      }
      throw error;
    }
    return this.getHealth();
  }

  public async refreshIfConfigured(warnMode: WarnMode): Promise<HookHealth> {
    const config = await readOptional(this.configPath);
    if (config === null) return { state: "off", reason: "not_configured" };
    if (!isManagedHookConfig(config, this.executable, this.installedHook))
      return { state: "degraded", reason: "foreign_config" };
    return this.enable(warnMode);
  }

  public async disable(): Promise<void> {
    const config = await readOptional(this.configPath);
    if (
      config !== null &&
      !isManagedHookConfig(config, this.executable, this.installedHook)
    ) {
      throw new Error("refusing_to_delete_foreign_hook_config");
    }
    await rm(this.configPath, { force: true });
    await rm(this.installedHook, { force: true });
  }
}
