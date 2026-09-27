export interface PostureInput {
  readonly policyPresent: boolean;
  readonly policyExpiresAt?: string;
  readonly hookInstalled: boolean;
  readonly lastHookInvocationAt?: string;
  readonly queuePending: number;
  readonly queueDropped: number;
  readonly now?: Date;
  readonly maximumSilenceMs?: number;
}

export type PostureReason =
  | "policy_missing"
  | "policy_expired_or_unknown"
  | "hook_missing"
  | "hook_evidence_stale"
  | "audit_events_dropped"
  | "audit_queue_saturated";

export interface PostureResult {
  readonly state: "healthy" | "degraded" | "failed";
  readonly reasons: readonly PostureReason[];
}

export function evaluatePosture(input: PostureInput): PostureResult {
  const now = (input.now ?? new Date()).getTime();
  const silence = input.maximumSilenceMs ?? 15 * 60 * 1000;
  const reasons: PostureReason[] = [];
  if (!input.policyPresent) reasons.push("policy_missing");
  if (
    input.policyExpiresAt === undefined ||
    !Number.isFinite(Date.parse(input.policyExpiresAt)) ||
    Date.parse(input.policyExpiresAt) <= now
  )
    reasons.push("policy_expired_or_unknown");
  if (!input.hookInstalled) reasons.push("hook_missing");
  const last =
    input.lastHookInvocationAt && Date.parse(input.lastHookInvocationAt);
  if (!last || now - last > silence) reasons.push("hook_evidence_stale");
  if (input.queueDropped > 0) reasons.push("audit_events_dropped");
  if (input.queuePending >= 1000) reasons.push("audit_queue_saturated");
  return {
    state:
      reasons.length === 0
        ? "healthy"
        : input.hookInstalled
          ? "degraded"
          : "failed",
    reasons,
  };
}
