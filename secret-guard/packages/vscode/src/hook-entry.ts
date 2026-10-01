import process from "node:process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { liveRelay, relayConnected } from "./gateway-delegation.js";
import { beginActivity } from "./hook-activity.js";
import { effectiveMode, readObserveDeadline } from "./observe-window.js";
import { RUNNER_VERSION } from "./runner-version.js";
import { delegation } from "./relay-delegation.js";

import {
  parseHookMode,
  readLocalFile,
  runHook,
  type FileReader,
} from "@xsom/secret-guard-cli/hook";
import {
  claudeAdapter,
  codexAdapter,
  copilotAdapter,
  type HostAdapter,
} from "@xsom/developer-guard-adapters";
import {
  evaluateHookInput,
  loadAppliedRulesPack,
  loadPolicy,
  observeCapOf,
  resolveApproval,
} from "@xsom/developer-guard-runner";
import { findHidden, type CompiledRulesPack } from "@xsom/secret-guard-core";

const MAX_HOOK_INPUT_BYTES = 1_200_000;
const STALE_SESSION_MESSAGE =
  "🔌 Secret Guard · Session non raccordée\nLe relais Secret Guard nettoie automatiquement, mais cette session Claude a été ouverte avant son activation. Ouvrez une nouvelle session, puis renvoyez votre message.";

async function readBoundedStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > MAX_HOOK_INPUT_BYTES) return "";
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function check(storage: string): Promise<void> {
  let rawInput = "";
  try {
    rawInput = await readBoundedStdin();
  } catch {
    // Empty input produces the protocol's fail-closed response.
  }
  // The organization's cap on Avertir comes from the managed policy verified
  // here again; without one, the 8-hour ceiling alone applies.
  const managed = await managedPolicy(storage);
  const mode = effectiveMode(
    parseHookMode(process.argv.slice(2)),
    readObserveDeadline(storage),
    Date.now(),
    managed.state === "verified" ? observeCapOf(managed.policy) : undefined,
  );
  // The relay cleans with the platform's rules only. With an xSOM tuning
  // loaded, a custom detection, or a scan that could not finish (budget,
  // too many findings: the tuning may not have run), must stay here.
  const rulesPack = await verifiedRulesPack(storage);
  let tuningNeedsLocalBlock = false;
  // What a local relay could not clean: files it cannot read, invisible
  // characters, scans that did not finish.
  const seen = { unanalysed: false, hidden: false, incomplete: false };
  const readFile: FileReader = (path) => {
    const file = readLocalFile(path);
    if (file.status === "unreadable") seen.unanalysed = true;
    if (file.status === "text" && hasHidden(file.content)) seen.hidden = true;
    return file;
  };
  const response = runHook(rawInput, mode, readFile, rulesPack, (result) => {
    if (!result.complete) seen.incomplete = true;
    if (
      result.findings.some((finding) => finding.custom !== undefined) ||
      (rulesPack !== undefined && !result.complete)
    )
      tuningNeedsLocalBlock = true;
  });
  const adapter = adapterFor(process.argv.slice(2));
  const policyResponse = await policyResponseFor(
    rawInput,
    adapter,
    storage,
    managed,
  );
  if (policyResponse !== undefined && !policyResponse.continue) {
    process.stderr.write(
      `${policyResponse.stderr ?? "xSOM Secret Guard refused this action."}\n`,
    );
    process.exitCode = 2;
    return;
  }
  // Prompts, their @-mentioned files and Read tool results all reach the
  // provider inside the request the relay cleans; nothing else is delegated.
  let relayedEvent: "prompt" | "read" | undefined;
  try {
    const input = JSON.parse(rawInput) as Record<string, unknown>;
    if (
      input.hook_event_name === "UserPromptSubmit" &&
      typeof input.prompt === "string"
    ) {
      relayedEvent = "prompt";
      if (hasHidden(input.prompt)) seen.hidden = true;
    } else if (
      input.hook_event_name === "PreToolUse" &&
      input.tool_name === "Read"
    )
      relayedEvent = "read";
  } catch {
    /* Invalid envelopes must remain blocked. */
  }
  const relay =
    !response.continue &&
    relayedEvent !== undefined &&
    mode === "redact" &&
    !tuningNeedsLocalBlock
      ? await liveRelay(storage, process.env.ANTHROPIC_BASE_URL)
      : undefined;
  const handover =
    relay === undefined || relayedEvent === undefined
      ? undefined
      : delegation(relay, relayedEvent, seen);
  if (handover?.delegate === true) {
    // The original travels only to the registered, mandatory-redaction route.
    process.stdout.write(
      `${JSON.stringify({ continue: true, systemMessage: handover.message })}\n`,
    );
    return;
  }
  if (!response.continue) {
    // Claude reads ANTHROPIC_BASE_URL once, when the session starts: a session
    // opened before the relay was connected can never delegate to it.
    const staleClaudeSession =
      relayedEvent !== undefined &&
      handover === undefined &&
      mode === "redact" &&
      !tuningNeedsLocalBlock &&
      process.env.CLAUDE_PROJECT_DIR !== undefined &&
      (await relayConnected(storage));
    process.stderr.write(
      `${staleClaudeSession ? STALE_SESSION_MESSAGE : (response.stopReason ?? "Secret Guard blocked this prompt.")}\n`,
    );
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function hasHidden(text: string): boolean {
  const report = findHidden(text);
  return !report.complete || report.hidden > 0;
}

/**
 * The xSOM rules pack stored by the extension, verified again here with the
 * authority keys of this build: the storage folder is not a trust anchor. A
 * refused, absent or unreadable pack leaves the built-in rules only.
 */
async function verifiedRulesPack(
  storage: string,
): Promise<CompiledRulesPack | undefined> {
  try {
    const applied = await loadAppliedRulesPack(storage);
    return applied.status === "applied" ? applied.pack : undefined;
  } catch {
    return undefined;
  }
}

function adapterFor(args: readonly string[]): HostAdapter {
  const host = args
    .find((arg) => arg.startsWith("--host="))
    ?.slice("--host=".length);
  if (host === "claude") return claudeAdapter;
  if (host === "codex") return codexAdapter;
  return copilotAdapter;
}

function managedRoots(): readonly string[] {
  const raw = process.env.XSOM_DEVELOPER_GUARD_ROOTS;
  return raw === undefined || raw === ""
    ? []
    : raw.split(process.platform === "win32" ? ";" : ":").filter(Boolean);
}

type VerifiedPolicy = NonNullable<Awaited<ReturnType<typeof loadPolicy>>>;

type ManagedPolicy =
  | { readonly state: "unmanaged" }
  | { readonly state: "unavailable" }
  | { readonly state: "verified"; readonly policy: VerifiedPolicy };

/**
 * The managed policy stored by the extension, verified again with the pinned
 * key and this build's version: the storage folder is not a trust anchor.
 */
async function managedPolicy(storage: string): Promise<ManagedPolicy> {
  let publicKey: string;
  try {
    publicKey = (
      await readFile(join(storage, "developer-policy.pub"), "utf8")
    ).trim();
  } catch {
    return { state: "unmanaged" };
  }
  if (publicKey === "") return { state: "unmanaged" };
  try {
    const policy = await loadPolicy(
      join(storage, "developer-policy.json"),
      publicKey,
      RUNNER_VERSION,
    );
    return policy === undefined
      ? { state: "unavailable" }
      : { state: "verified", policy };
  } catch {
    return { state: "unavailable" };
  }
}

async function policyResponseFor(
  rawInput: string,
  adapter: HostAdapter,
  storage: string,
  managed: ManagedPolicy,
) {
  if (managed.state === "unmanaged") return undefined;
  try {
    if (managed.state === "unavailable")
      throw new Error("managed_policy_unavailable");
    const input = JSON.parse(rawInput) as Record<string, unknown>;
    const result = evaluateHookInput(
      adapter,
      input,
      managed.policy,
      managedRoots(),
    );
    if (result.decision?.effect === "require_approval") {
      const adapted = adapter.adapt(input);
      const approval =
        adapted === null
          ? "unavailable"
          : await resolveApproval(
              storage,
              rawInput,
              adapted.request,
              result.decision,
            );
      if (approval === "approved")
        return adapter.respond({
          ...result.decision,
          effect: "allow",
          reason: "approval_consumed",
        });
      return adapter.respond({
        ...result.decision,
        effect: "deny",
        reason:
          approval === "pending"
            ? "approval_pending"
            : "approval_bridge_unavailable",
      });
    }
    return result.decision === undefined
      ? undefined
      : adapter.respond(result.decision);
  } catch {
    // A managed path must never turn a broken policy or envelope into permission.
    return adapter.respond({
      effect: "deny",
      reason: "managed_policy_unavailable",
      matchedRuleIds: [],
    });
  }
}

async function main(): Promise<void> {
  // The installed hook lives in the extension's storage folder.
  const storage = dirname(process.argv[1] ?? "");
  const done = beginActivity(storage);
  try {
    await check(storage);
  } finally {
    done();
  }
}

void main();
