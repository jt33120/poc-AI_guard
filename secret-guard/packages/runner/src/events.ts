import type { Assistant, PolicyDecision } from "@xsom/developer-guard-policy";
export interface SafeEvent {
  readonly kind: "policy" | "posture";
  readonly assistant: Assistant;
  readonly outcome:
    "allowed" | "denied" | "approval_required" | "unverified" | "failed";
  readonly policyId?: string;
  readonly policyVersion?: number;
  readonly ruleIds: readonly string[];
}
export function eventForDecision(
  assistant: Assistant,
  decision: PolicyDecision,
): SafeEvent {
  return {
    kind: "policy",
    assistant,
    outcome:
      decision.effect === "allow"
        ? "allowed"
        : decision.effect === "deny"
          ? "denied"
          : "approval_required",
    ...(decision.policyId === undefined ? {} : { policyId: decision.policyId }),
    ...(decision.policyVersion === undefined
      ? {}
      : { policyVersion: decision.policyVersion }),
    ruleIds: decision.matchedRuleIds,
  };
}
