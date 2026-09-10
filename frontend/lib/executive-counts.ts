export interface DecisionCounts {
  allow: number;
  review: number;
  block: number;
}

type DecisionBucket = keyof DecisionCounts | "other";

// Keep this explicit, in line with core/export.py. Guard events, monitor-mode
// observations and uninspected traffic are not authorization decisions.
export function decisionBucket(
  decision: string | null | undefined,
): DecisionBucket {
  switch (decision?.toLowerCase()) {
    case "allow":
    case "auto":
    case "notify":
    case "approved":
      return "allow";
    case "hitl_pending":
    case "hold":
    case "hitl_approved":
      return "review";
    case "deny":
    case "hitl_denied":
    case "expired":
    case "rbac_denied":
    case "tainted_action":
    case "agent_stopped":
    case "stop_state_unreadable":
      return "block";
    default:
      return "other";
  }
}

export function summarizeDecisions(entries: { decision: string | null }[]) {
  const counts: DecisionCounts = { allow: 0, review: 0, block: 0 };
  let other = 0;
  for (const entry of entries) {
    const bucket = decisionBucket(entry.decision);
    if (bucket === "other") other += 1;
    else counts[bucket] += 1;
  }
  return { counts, other };
}
