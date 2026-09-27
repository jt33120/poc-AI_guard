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

/**
 * Longest Avertir (warn) window the organization allows on its workstations,
 * in minutes: 0 forbids Avertir, a length bounds it.
 */
export const OBSERVE_CAP_MINUTES = [0, 15, 60, 240, 480] as const;
export type ObserveCapMinutes = (typeof OBSERVE_CAP_MINUTES)[number];

/** Workstation settings a signed policy can only restrict. */
export interface WorkstationSettings {
  readonly observeMaxMinutes: ObserveCapMinutes;
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
  readonly workstation?: WorkstationSettings;
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
