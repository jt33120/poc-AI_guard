/** Metadata returned by the existing Control API. No tool argument values. */
export interface ToolView {
  name: string;
  canonical: string;
  action_class: string | null;
  decision: string;
}
export interface AuditEntry {
  id: number;
  ts: string | null;
  tool_name: string | null;
  action_class: string | null;
  decision: string | null;
  args_hash: string | null;
  gateway_token_id?: string | null;
  error?: string | null;
  policy_rule_id?: string | null;
  request_id?: string | null;
  latency_ms?: number | null;
  judge_used?: boolean;
  ingress?: string | null;
  enforcement_mode?: string | null;
}
export function signalKinds(event: AuditEntry): string[] {
  const evidence = `${event.error ?? ""} ${event.decision ?? ""}`.toLowerCase();
  return [
    ...(event.tool_name?.endsWith(".egress") || evidence.includes("dlp:")
      ? ["DLP"]
      : []),
    ...(evidence.includes("taint") ? ["taint"] : []),
    ...(evidence.includes("drift") ? ["drift"] : []),
    ...(evidence.includes("quarantine") ? ["quarantine"] : []),
    ...(evidence.includes("cost_spike") || evidence.includes("cost-spike")
      ? ["cost spike"]
      : []),
  ];
}
