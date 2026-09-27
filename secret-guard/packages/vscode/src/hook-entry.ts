import process from "node:process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canDelegate, relayConnected } from "./gateway-delegation.js";
import { beginActivity } from "./hook-activity.js";
import { effectiveMode, readObserveDeadline } from "./observe-window.js";

import { parseHookMode, runHook } from "@xsom/secret-guard-cli/hook";
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
  resolveApproval,
} from "@xsom/developer-guard-runner";
import type { CompiledRulesPack } from "@xsom/secret-guard-core";

const MAX_HOOK_INPUT_BYTES = 1_200_000;
const STALE_SESSION_MESSAGE =
  "🔌 Secret Guard · Session non raccordée\nLe relais xSOM nettoie automatiquement, mais cette session Claude a été ouverte avant le raccordement. Ouvrez une nouvelle session, puis renvoyez votre message.";

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
  const mode = effectiveMode(
    parseHookMode(process.argv.slice(2)),
    readObserveDeadline(storage),
    Date.now(),
  );
  // The relay cleans with the platform's rules only. With an xSOM tuning
  // loaded, a custom detection, or a scan that could not finish (budget,
  // too many findings: the tuning may not have run), must stay here.
  const rulesPack = await verifiedRulesPack(storage);
  let tuningNeedsLocalBlock = false;
  const response = runHook(rawInput, mode, undefined, rulesPack, (result) => {
    if (
      result.findings.some((finding) => finding.custom !== undefined) ||
      (rulesPack !== undefined && !result.complete)
    )
      tuningNeedsLocalBlock = true;
  });
  const adapter = adapterFor(process.argv.slice(2));
  const policyResponse = await policyResponseFor(rawInput, adapter, storage);
  if (policyResponse !== undefined && !policyResponse.continue) {
    process.stderr.write(
      `${policyResponse.stderr ?? "xSOM Secret Guard refused this action."}\n`,
    );
    process.exitCode = 2;
    return;
  }
  // Prompts, their @-mentioned files and Read tool results all reach the
  // provider inside the request the relay cleans; nothing else is delegated.
  let relayedEvent = false;
  try {
    const input = JSON.parse(rawInput) as Record<string, unknown>;
    relayedEvent =
      (input.hook_event_name === "UserPromptSubmit" &&
        typeof input.prompt === "string") ||
      (input.hook_event_name === "PreToolUse" && input.tool_name === "Read");
  } catch {
    /* Invalid envelopes must remain blocked. */
  }
  if (
    !response.continue &&
    relayedEvent &&
    mode === "redact" &&
    !tuningNeedsLocalBlock &&
    (await canDelegate(storage, process.env.ANTHROPIC_BASE_URL))
  ) {
    // The original travels only to the registered, mandatory-redaction route.
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
    return;
  }
  if (!response.continue) {
    // Claude reads ANTHROPIC_BASE_URL once, when the session starts: a session
    // opened before the relay was connected can never delegate to it.
    const staleClaudeSession =
      relayedEvent &&
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

async function policyResponseFor(
  rawInput: string,
  adapter: HostAdapter,
  storage: string,
) {
  const policyPath = join(storage, "developer-policy.json");
  const publicKeyPath = join(storage, "developer-policy.pub");
  let publicKey: string;
  try {
    publicKey = (await readFile(publicKeyPath, "utf8")).trim();
  } catch {
    return undefined;
  }
  if (publicKey === "") return undefined;
  try {
    const input = JSON.parse(rawInput) as Record<string, unknown>;
    const result = evaluateHookInput(
      adapter,
      input,
      await loadPolicy(policyPath, publicKey),
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
