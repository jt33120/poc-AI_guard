import type {
  ActionRequest,
  Assistant,
  PolicyDecision,
} from "@xsom/developer-guard-policy";

export interface RawHookInput {
  readonly hook_event_name?: unknown;
  readonly hookEventName?: unknown;
  readonly prompt?: unknown;
  readonly tool_name?: unknown;
  readonly toolName?: unknown;
  readonly tool_input?: unknown;
  readonly toolInput?: unknown;
  readonly cwd?: unknown;
  readonly command?: unknown;
}

export interface AdapterCapability {
  readonly assistant: Assistant;
  readonly events: readonly ActionRequest["event"][];
  readonly protocol: "claude" | "codex" | "copilot";
  readonly verified: boolean;
}

export interface AdaptedHook {
  readonly request: ActionRequest;
  readonly prompt?: string;
  readonly path?: string;
}

export interface HostResponse {
  readonly continue: boolean;
  readonly output?: Record<string, unknown>;
  readonly stderr?: string;
}

export interface HostAdapter {
  readonly capability: AdapterCapability;
  adapt(input: RawHookInput): AdaptedHook | null;
  respond(decision: PolicyDecision): HostResponse;
}
