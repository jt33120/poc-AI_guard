import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

import type * as vscode from "vscode";

import {
  hookModeArgument,
  type ProtectionMode,
} from "@xsom/secret-guard-cli/hook";

import { QUIET_ACTIVITY_ENV } from "./hook-activity.js";
import {
  configureHost,
  defaultHostDefinitions,
  inspectHostConfig,
  type HookHost,
  type HostDefinition,
  unconfigureHost,
} from "./host-config.js";

const CANARY_TIMEOUT_MS = 5_000;
const MAX_CANARY_OUTPUT_BYTES = 64 * 1024;

export type HookHealthState = "off" | "active" | "partial" | "degraded";

export interface HostHealth {
  readonly id: HookHost;
  readonly label: string;
  readonly configured: boolean;
}

export interface HookHealth {
  readonly state: HookHealthState;
  readonly reason:
    | "not_configured"
    | "local_canaries_verified"
    | "config_invalid"
    | "hook_missing"
    | "hook_modified"
    | "canary_failed";
  readonly hosts: readonly HostHealth[];
}

export interface HookManagerOptions {
  readonly configPath?: string;
  readonly executable?: string;
  readonly hosts?: readonly HostDefinition[];
}

interface HookExecution {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
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

async function readOptionalBytes(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
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

async function writeAtomically(
  path: string,
  content: string | Buffer,
): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await rm(temporary, { force: true });
  await writeFile(temporary, content, { mode: 0o600 });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function restoreOptional(
  path: string,
  content: string | Buffer | null,
): Promise<void> {
  if (content === null) await rm(path, { force: true });
  else await writeAtomically(path, content);
}

function promptInput(prompt: string): string {
  return JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt });
}

function fileReadInput(filePath: string): string {
  return JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: filePath },
  });
}

function executeHook(
  executable: string,
  hookPath: string,
  input: string,
  mode: ProtectionMode,
): Promise<HookExecution> {
  return new Promise((resolve) => {
    const child = spawn(executable, [hookPath, hookModeArgument(mode)], {
      // Health checks must not show up as a user-facing check in progress.
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        [QUIET_ACTIVITY_ENV]: "1",
      },
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
      // A rejected hook can close stdin before the canary has been written.
    });
    child.stdin.end(input);
  });
}

const SYNTHETIC_CANARY = `ghp_${"Sg7".repeat(12)}`;
const CLEAN_CANARY_TEXT = "Explain this local function.";
const SECRET_CANARY_TEXT = `Review candidate ${SYNTHETIC_CANARY}`;

// The hook must let the clean input through untouched and stop (or, in
// observe mode, flag) the synthetic secret without echoing it.
async function verifyContract(
  executable: string,
  hookPath: string,
  mode: ProtectionMode,
  cleanInput: string,
  secretInput: string,
): Promise<boolean> {
  const clean = await executeHook(executable, hookPath, cleanInput, mode);
  const blocked = await executeHook(executable, hookPath, secretInput, mode);

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
  let findingHandled =
    blocked.exitCode === 2 &&
    blocked.stdout === "" &&
    blocked.stderr.length > 0;
  if (mode === "observe") {
    try {
      const response = JSON.parse(blocked.stdout) as {
        continue?: unknown;
        systemMessage?: unknown;
      };
      findingHandled =
        blocked.exitCode === 0 &&
        blocked.stderr === "" &&
        response.continue === true &&
        typeof response.systemMessage === "string" &&
        response.systemMessage.length > 0;
    } catch {
      return false;
    }
  }
  return (
    clean.exitCode === 0 &&
    !clean.timedOut &&
    clean.stderr === "" &&
    cleanAllowed &&
    findingHandled &&
    !blocked.timedOut &&
    !output.includes(SYNTHETIC_CANARY)
  );
}

export function verifyHookCanary(
  executable: string,
  hookPath: string,
  mode: ProtectionMode = "block",
): Promise<boolean> {
  return verifyContract(
    executable,
    hookPath,
    mode,
    promptInput(CLEAN_CANARY_TEXT),
    promptInput(SECRET_CANARY_TEXT),
  );
}

export async function verifyFileReadCanary(
  executable: string,
  hookPath: string,
  mode: ProtectionMode = "block",
): Promise<boolean> {
  const directory = await mkdtemp(join(tmpdir(), "secret-guard-canary-"));
  try {
    const cleanFile = join(directory, "clean.md");
    const flaggedFile = join(directory, "flagged.md");
    await writeFile(cleanFile, CLEAN_CANARY_TEXT, { mode: 0o600 });
    await writeFile(flaggedFile, SECRET_CANARY_TEXT, { mode: 0o600 });
    return await verifyContract(
      executable,
      hookPath,
      mode,
      fileReadInput(cleanFile),
      fileReadInput(flaggedFile),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function verifyCanaries(
  executable: string,
  hookPath: string,
  hosts: readonly HostDefinition[],
  mode: ProtectionMode,
): Promise<boolean> {
  const checks = [verifyHookCanary(executable, hookPath, mode)];
  if (hosts.some((host) => host.guardsFileReads === true))
    checks.push(verifyFileReadCanary(executable, hookPath, mode));
  return (await Promise.all(checks)).every(Boolean);
}

export class HookManager {
  private readonly bundledHook: string;
  private readonly installedHook: string;
  private readonly executable: string;
  private readonly hosts: readonly HostDefinition[];

  public constructor(
    context: vscode.ExtensionContext,
    options: HookManagerOptions = {},
  ) {
    this.bundledHook = join(context.extensionUri.fsPath, "dist", "hook.cjs");
    this.installedHook = join(context.globalStorageUri.fsPath, "hook.cjs");
    this.executable = options.executable ?? process.execPath;
    if (options.hosts !== undefined) this.hosts = options.hosts;
    else if (options.configPath !== undefined) {
      const [vscodeHost] = defaultHostDefinitions();
      if (vscodeHost === undefined) throw new Error("missing_vscode_host");
      this.hosts = [{ ...vscodeHost, configPath: options.configPath }];
    } else this.hosts = defaultHostDefinitions();
  }

  private async configStates() {
    return Promise.all(
      this.hosts.map(async (host) => {
        const content = await readOptional(host.configPath);
        return {
          host,
          content,
          state: inspectHostConfig(
            content,
            host,
            this.executable,
            this.installedHook,
          ),
        };
      }),
    );
  }

  public async getHealth(): Promise<HookHealth> {
    const states = await this.configStates();
    const hosts = states.map(({ host, state }) => ({
      id: host.id,
      label: host.label,
      configured: state === "configured",
    }));
    if (states.some(({ state }) => state === "degraded"))
      return { state: "degraded", reason: "config_invalid", hosts };
    const configured = states.filter(({ state }) => state === "configured");
    if (configured.length === 0)
      return { state: "off", reason: "not_configured", hosts };
    if (!(await pathExists(this.installedHook)))
      return { state: "degraded", reason: "hook_missing", hosts };
    if (
      !(await pathExists(this.bundledHook)) ||
      !(await filesMatch(this.bundledHook, this.installedHook))
    ) {
      return { state: "degraded", reason: "hook_modified", hosts };
    }
    const healthy = await verifyCanaries(
      this.executable,
      this.installedHook,
      configured.map(({ host }) => host),
      "block",
    );
    if (!healthy) return { state: "degraded", reason: "canary_failed", hosts };
    return {
      state: configured.length === this.hosts.length ? "active" : "partial",
      reason: "local_canaries_verified",
      hosts,
    };
  }

  public async isConfigured(): Promise<boolean> {
    return (await this.getHealth()).state === "active";
  }

  public async enable(mode: ProtectionMode): Promise<HookHealth> {
    const previousConfigs = await Promise.all(
      this.hosts.map(async (host) => ({
        host,
        content: await readOptional(host.configPath),
      })),
    );
    const nextConfigs = previousConfigs.map(({ host, content }) => ({
      host,
      content: configureHost(
        content,
        host,
        this.executable,
        this.installedHook,
        mode,
      ),
    }));
    const previousHook = await readOptionalBytes(this.installedHook);
    const candidate = `${this.installedHook}.${process.pid}.candidate`;
    await mkdir(dirname(this.installedHook), { recursive: true });
    await rm(candidate, { force: true });
    await copyFile(this.bundledHook, candidate);
    if (!(await verifyCanaries(this.executable, candidate, this.hosts, mode))) {
      await rm(candidate, { force: true });
      throw new Error("hook_canary_failed");
    }
    await rename(candidate, this.installedHook);

    const written: HostDefinition[] = [];
    try {
      for (const next of nextConfigs) {
        await writeAtomically(next.host.configPath, next.content);
        written.push(next.host);
      }
    } catch (error) {
      for (const host of written.reverse()) {
        const previous = previousConfigs.find(
          (candidateConfig) => candidateConfig.host.id === host.id,
        );
        await restoreOptional(host.configPath, previous?.content ?? null);
      }
      await restoreOptional(this.installedHook, previousHook);
      throw error;
    }
    return this.getHealth();
  }

  public async refreshIfConfigured(mode: ProtectionMode): Promise<HookHealth> {
    const states = await this.configStates();
    if (states.every(({ state }) => state === "off")) return this.getHealth();
    if (states.some(({ state }) => state === "degraded"))
      return this.getHealth();
    return this.enable(mode);
  }

  public async disable(): Promise<void> {
    const previousConfigs = await Promise.all(
      this.hosts.map(async (host) => ({
        host,
        content: await readOptional(host.configPath),
      })),
    );
    const nextConfigs = previousConfigs.map(({ host, content }) => ({
      host,
      content: unconfigureHost(
        content,
        host,
        this.executable,
        this.installedHook,
      ),
    }));
    const written: HostDefinition[] = [];
    try {
      for (const next of nextConfigs) {
        await restoreOptional(next.host.configPath, next.content);
        written.push(next.host);
      }
      await rm(this.installedHook, { force: true });
    } catch (error) {
      for (const host of written.reverse()) {
        const previous = previousConfigs.find(
          (candidateConfig) => candidateConfig.host.id === host.id,
        );
        await restoreOptional(host.configPath, previous?.content ?? null);
      }
      throw error;
    }
  }
}
