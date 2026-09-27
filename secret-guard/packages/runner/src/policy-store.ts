import { readFile } from "node:fs/promises";
import {
  OBSERVE_CAP_MINUTES,
  type DeveloperPolicy,
  type ObserveCapMinutes,
  type PolicyEffect,
} from "@xsom/developer-guard-policy";
import { verifyPolicySignature } from "./policy-signature.js";

function isEffect(value: unknown): value is PolicyEffect {
  return value === "allow" || value === "deny" || value === "require_approval";
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function boundedEnumArray(
  value: unknown,
  allowed: readonly string[],
  maximum: number,
): boolean {
  return (
    value === undefined ||
    (isStringArray(value) &&
      value.length <= maximum &&
      value.every((item) => allowed.includes(item)))
  );
}

function isRule(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const rule = value as Record<string, unknown>;
  const match = rule.match;
  if (
    !exactKeys(rule, ["id", "effect", "reason", "match"]) ||
    typeof rule.id !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(rule.id) ||
    !isEffect(rule.effect) ||
    (rule.reason !== undefined &&
      (typeof rule.reason !== "string" || rule.reason.length > 240)) ||
    typeof match !== "object" ||
    match === null ||
    Array.isArray(match)
  )
    return false;
  const fields = match as Record<string, unknown>;
  return (
    exactKeys(fields, [
      "assistants",
      "events",
      "actionClasses",
      "resourcePrefixes",
      "tools",
    ]) &&
    boundedEnumArray(
      fields.assistants,
      ["claude", "codex", "copilot", "unknown"],
      4,
    ) &&
    boundedEnumArray(
      fields.events,
      [
        "prompt",
        "read",
        "write",
        "delete",
        "command",
        "network",
        "mcp",
        "unknown",
      ],
      8,
    ) &&
    boundedEnumArray(
      fields.actionClasses,
      [
        "read",
        "write",
        "delete",
        "publish",
        "deploy",
        "network",
        "security",
        "mcp",
        "unknown",
      ],
      9,
    ) &&
    (fields.resourcePrefixes === undefined ||
      (isStringArray(fields.resourcePrefixes) &&
        fields.resourcePrefixes.length <= 100 &&
        fields.resourcePrefixes.every(
          (item) => item.length > 0 && item.length <= 1024,
        ))) &&
    (fields.tools === undefined ||
      (isStringArray(fields.tools) &&
        fields.tools.length <= 100 &&
        fields.tools.every((item) => item.length > 0 && item.length <= 256)))
  );
}

function isObserveCap(value: unknown): value is ObserveCapMinutes {
  return OBSERVE_CAP_MINUTES.some((minutes) => minutes === value);
}

function isWorkstation(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const settings = value as Record<string, unknown>;
  return (
    exactKeys(settings, ["observeMaxMinutes"]) &&
    isObserveCap(settings.observeMaxMinutes)
  );
}

function isPolicy(value: unknown): value is DeveloperPolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const policy = value as Record<string, unknown>;
  const defaults = policy.defaults as Record<string, unknown> | undefined;
  const issued =
    typeof policy.issuedAt === "string"
      ? Date.parse(policy.issuedAt)
      : Number.NaN;
  const expires =
    typeof policy.expiresAt === "string"
      ? Date.parse(policy.expiresAt)
      : Number.NaN;
  return (
    exactKeys(policy, [
      "schemaVersion",
      "tenantId",
      "policyId",
      "version",
      "issuedAt",
      "expiresAt",
      "minRunnerVersion",
      "defaults",
      "rules",
      "workstation",
    ]) &&
    policy.schemaVersion === 1 &&
    (policy.tenantId === undefined ||
      (typeof policy.tenantId === "string" &&
        policy.tenantId.length >= 1 &&
        policy.tenantId.length <= 128)) &&
    typeof policy.policyId === "string" &&
    policy.policyId.length >= 1 &&
    policy.policyId.length <= 128 &&
    Number.isSafeInteger(policy.version) &&
    (policy.version as number) >= 1 &&
    Number.isFinite(issued) &&
    Number.isFinite(expires) &&
    issued < expires &&
    (policy.minRunnerVersion === undefined ||
      (typeof policy.minRunnerVersion === "string" &&
        policy.minRunnerVersion.length >= 1 &&
        policy.minRunnerVersion.length <= 64)) &&
    defaults !== undefined &&
    typeof defaults === "object" &&
    exactKeys(defaults, ["unknownAction"]) &&
    isEffect(defaults.unknownAction) &&
    Array.isArray(policy.rules) &&
    policy.rules.length <= 500 &&
    policy.rules.every(isRule) &&
    new Set(policy.rules.map((rule) => (rule as Record<string, unknown>).id))
      .size === policy.rules.length &&
    isWorkstation(policy.workstation)
  );
}

interface SignedPolicy {
  readonly policy: unknown;
  readonly signature: unknown;
  readonly publicKey: unknown;
}

function isSignedPolicy(value: unknown): value is SignedPolicy {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "policy" in value &&
    "signature" in value &&
    "publicKey" in value
  );
}

export function validateSignedPolicyDocument(
  parsed: unknown,
  pinnedPublicKey: string | undefined,
  runnerVersion = "0.1.0",
): DeveloperPolicy {
  if (
    !isSignedPolicy(parsed) ||
    typeof parsed.signature !== "string" ||
    typeof parsed.publicKey !== "string"
  )
    throw new Error("unsigned_policy_document");
  if (
    pinnedPublicKey === undefined ||
    pinnedPublicKey === "" ||
    pinnedPublicKey !== parsed.publicKey
  )
    throw new Error("policy_key_not_pinned");
  const signed = parsed.policy;
  if (
    typeof signed !== "object" ||
    signed === null ||
    Array.isArray(signed) ||
    !verifyPolicySignature(
      signed as Record<string, unknown>,
      parsed.signature,
      parsed.publicKey,
    )
  )
    throw new Error("invalid_policy_signature");
  // Checked before the shape: a policy written for a newer runner may carry
  // fields this one does not know, and says so instead of looking malformed.
  const required = (signed as Record<string, unknown>).minRunnerVersion;
  if (
    typeof required === "string" &&
    compareVersions(runnerVersion, required) < 0
  )
    throw new Error("runner_version_too_old");
  if (!isPolicy(signed)) throw new Error("invalid_policy_signature");
  return signed;
}

/**
 * The organization's cap on Avertir from a verified policy, in minutes: 0
 * forbids Avertir. Undefined without a policy or without a cap, where the
 * extension's own ceiling applies. Never a reason to allow more.
 */
export function observeCapOf(
  policy: DeveloperPolicy | undefined,
): ObserveCapMinutes | undefined {
  return policy?.workstation?.observeMaxMinutes;
}

export async function loadPolicy(
  path: string | undefined,
  pinnedPublicKey = process.env.XSOM_DEVELOPER_GUARD_PUBLIC_KEY,
  runnerVersion = "0.1.0",
): Promise<DeveloperPolicy | undefined> {
  if (path === undefined || path === "") return undefined;
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return validateSignedPolicyDocument(parsed, pinnedPublicKey, runnerVersion);
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] | undefined => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(value);
    return match?.slice(1).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  if (a === undefined || b === undefined)
    throw new Error("invalid_runner_version");
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}
