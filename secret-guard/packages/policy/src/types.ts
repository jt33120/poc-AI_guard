export const POLICY_SCHEMA_VERSION = 1 as const;

export type Assistant = "claude" | "codex" | "copilot" | "unknown";
export type PolicyEvent =
  | "prompt"
  | "read"
  | "write"
  | "delete"
  | "command"
  | "network"
  | "mcp"
  | "unknown";
export type ActionClass =
  | "read"
  | "write"
  | "delete"
  | "publish"
  | "deploy"
  | "network"
  | "security"
  | "mcp"
  | "unknown";
export type PolicyEffect = "allow" | "deny" | "require_approval";

export interface PolicyMatch {
  readonly assistants?: readonly Assistant[];
  readonly events?: readonly PolicyEvent[];
  readonly actionClasses?: readonly ActionClass[];
  readonly resourcePrefixes?: readonly string[];
  readonly tools?: readonly string[];
}

export interface PolicyRule {
  readonly id: string;
  readonly effect: PolicyEffect;
  readonly reason?: string;
  readonly match: PolicyMatch;
}

export interface DeveloperPolicy {
  readonly schemaVersion: typeof POLICY_SCHEMA_VERSION;
  readonly tenantId?: string;
  readonly policyId: string;
  readonly version: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly minRunnerVersion?: string;
  readonly defaults: { readonly unknownAction: PolicyEffect };
  readonly rules: readonly PolicyRule[];
}

export interface ActionRequest {
  readonly assistant: Assistant;
  readonly event: PolicyEvent;
  readonly actionClass: ActionClass;
  readonly resource?: string;
  readonly tool?: string;
  readonly capabilityVerified: boolean;
}

export interface PolicyDecision {
  readonly effect: PolicyEffect;
  readonly reason: string;
  readonly policyId?: string;
  readonly policyVersion?: number;
  readonly matchedRuleIds: readonly string[];
}
