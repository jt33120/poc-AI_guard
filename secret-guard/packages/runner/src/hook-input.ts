import {
  evaluatePolicy,
  evaluateResource,
  type DeveloperPolicy,
  type PolicyDecision,
} from "@xsom/developer-guard-policy";
import type { HostAdapter, RawHookInput } from "@xsom/developer-guard-adapters";

export interface HookPolicyResult {
  readonly decision?: PolicyDecision;
  readonly ignored: boolean;
}

/** Evaluate only known, pre-action hook envelopes. Raw arguments never leave this process. */
export function evaluateHookInput(
  adapter: HostAdapter,
  input: RawHookInput,
  policy: DeveloperPolicy | undefined,
  roots: readonly string[] = [],
): HookPolicyResult {
  const adapted = adapter.adapt(input);
  if (adapted === null) return { ignored: true };
  // Prompts keep Secret Guard's established scanner contract. They gain a policy
  // decision only if the organisation deliberately defines one.
  if (adapted.request.event === "prompt" && policy === undefined)
    return { ignored: true };
  if (adapted.path !== undefined) {
    const resource = evaluateResource(adapted.path, roots);
    if (!resource.allowed)
      return {
        ignored: false,
        decision: {
          effect: "deny",
          reason: resource.reason ?? "resource_denied",
          matchedRuleIds: [],
        },
      };
  }
  return { ignored: false, decision: evaluatePolicy(policy, adapted.request) };
}
