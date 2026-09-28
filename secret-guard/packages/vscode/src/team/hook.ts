import process from "node:process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
import type { CompiledRulesPack } from "@xsom/secret-guard-core";
import type { HookScan, HookTeam, HookVerdict } from "../team-port.js";
import { canDelegate, relayConnected } from "./gateway-delegation.js";
import { RUNNER_VERSION } from "./runner-version.js";

const STALE_SESSION_MESSAGE =
  "🔌 Secret Guard · Session non raccordée\nLe relais xSOM nettoie automatiquement, mais cette session Claude a été ouverte avant le raccordement. Ouvrez une nouvelle session, puis renvoyez votre message.";

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

/**
 * Prompts, their @-mentioned files and Read tool results all reach the
 * provider inside the request the relay cleans; nothing else is delegated.
 */
function relayedEvent(rawInput: string): boolean {
  try {
    const input = JSON.parse(rawInput) as Record<string, unknown>;
    return (
      (input.hook_event_name === "UserPromptSubmit" &&
        typeof input.prompt === "string") ||
      (input.hook_event_name === "PreToolUse" && input.tool_name === "Read")
    );
  } catch {
    return false; // Invalid envelopes must remain blocked.
  }
}

interface CheckContext {
  readonly storage: string;
  readonly adapter: HostAdapter;
  readonly managed: ManagedPolicy;
  readonly rules: CompiledRulesPack | undefined;
}

async function settle(
  scan: HookScan,
  context: CheckContext,
): Promise<HookVerdict | undefined> {
  const policyResponse = await policyResponseFor(
    scan.rawInput,
    context.adapter,
    context.storage,
    context.managed,
  );
  if (policyResponse !== undefined && !policyResponse.continue)
    return {
      effect: "refuse",
      message:
        policyResponse.stderr ?? "xSOM Secret Guard refused this action.",
    };
  if (scan.response.continue) return undefined;
  // The relay cleans with the platform's rules only. With an xSOM tuning
  // loaded, a custom detection, or a scan that could not finish (budget,
  // too many findings: the tuning may not have run), must stay here.
  const tuningNeedsLocalBlock = scan.results.some(
    (result) =>
      result.findings.some((finding) => finding.custom !== undefined) ||
      (context.rules !== undefined && !result.complete),
  );
  if (
    !relayedEvent(scan.rawInput) ||
    scan.mode !== "redact" ||
    tuningNeedsLocalBlock
  )
    return undefined;
  // The original travels only to the registered, mandatory-redaction route.
  if (await canDelegate(context.storage, process.env.ANTHROPIC_BASE_URL))
    return { effect: "delegate" };
  // Claude reads ANTHROPIC_BASE_URL once, when the session starts: a session
  // opened before the relay was connected can never delegate to it.
  if (
    process.env.CLAUDE_PROJECT_DIR !== undefined &&
    (await relayConnected(context.storage))
  )
    return { effect: "explain", message: STALE_SESSION_MESSAGE };
  return undefined;
}

/** The Équipe side of the installed hook. */
export const hookTeam: HookTeam = {
  async prepare(storage, args) {
    // The organization's cap on Avertir comes from the managed policy
    // verified here again.
    const managed = await managedPolicy(storage);
    const rules = await verifiedRulesPack(storage);
    const context: CheckContext = {
      storage,
      adapter: adapterFor(args),
      managed,
      rules,
    };
    return {
      observeCap:
        managed.state === "verified" ? observeCapOf(managed.policy) : undefined,
      ...(rules === undefined ? {} : { rules }),
      settle: (scan) => settle(scan, context),
    };
  },
};
