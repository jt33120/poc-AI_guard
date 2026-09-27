import type {
  ActionRequest,
  DeveloperPolicy,
  PolicyDecision,
  PolicyEffect,
  PolicyMatch,
} from "./types.js";

function contains<T>(values: readonly T[] | undefined, value: T): boolean {
  return values === undefined || values.includes(value);
}

function prefixMatches(
  prefixes: readonly string[] | undefined,
  resource: string | undefined,
): boolean {
  if (prefixes === undefined) return true;
  return (
    resource !== undefined &&
    prefixes.some((prefix) => resource.startsWith(prefix))
  );
}

function toolMatches(
  tools: readonly string[] | undefined,
  tool: string | undefined,
): boolean {
  return tools === undefined || (tool !== undefined && tools.includes(tool));
}

export function matches(match: PolicyMatch, request: ActionRequest): boolean {
  return (
    contains(match.assistants, request.assistant) &&
    contains(match.events, request.event) &&
    contains(match.actionClasses, request.actionClass) &&
    prefixMatches(match.resourcePrefixes, request.resource) &&
    toolMatches(match.tools, request.tool)
  );
}

function isExpired(policy: DeveloperPolicy, now: Date): boolean {
  const issued = Date.parse(policy.issuedAt);
  const expires = Date.parse(policy.expiresAt);
  return (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    issued > now.getTime() ||
    expires <= now.getTime()
  );
}

function strongest(effects: readonly PolicyEffect[]): PolicyEffect {
  if (effects.includes("deny")) return "deny";
  if (effects.includes("require_approval")) return "require_approval";
  return "allow";
}

export function evaluatePolicy(
  policy: DeveloperPolicy | undefined,
  request: ActionRequest,
  now = new Date(),
): PolicyDecision {
  if (!request.capabilityVerified && request.actionClass !== "read") {
    return {
      effect: "deny",
      reason: "host_capability_unverified",
      matchedRuleIds: [],
    };
  }
  if (policy === undefined) {
    return {
      effect: request.actionClass === "read" ? "allow" : "deny",
      reason: "no_managed_policy",
      matchedRuleIds: [],
    };
  }
  if (policy.schemaVersion !== 1 || isExpired(policy, now)) {
    return {
      effect: "deny",
      reason: "policy_invalid_or_expired",
      policyId: policy.policyId,
      policyVersion: policy.version,
      matchedRuleIds: [],
    };
  }
  const matched = policy.rules.filter((rule) => matches(rule.match, request));
  const effect =
    matched.length === 0
      ? policy.defaults.unknownAction
      : strongest(matched.map((rule) => rule.effect));
  return {
    effect,
    reason:
      matched.map((rule) => rule.reason ?? rule.id).join("; ") ||
      "policy_default",
    policyId: policy.policyId,
    policyVersion: policy.version,
    matchedRuleIds: matched.map((rule) => rule.id),
  };
}
