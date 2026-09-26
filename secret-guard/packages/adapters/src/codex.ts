import type { PolicyDecision } from "@xsom/developer-guard-policy";
import { adapt, denialMessage } from "./shared.js";
import type { HostAdapter, HostResponse, RawHookInput } from "./types.js";

export const codexAdapter: HostAdapter = {
  capability: {
    assistant: "codex",
    events: ["prompt"],
    protocol: "codex",
    verified: true,
  },
  adapt(input: RawHookInput) {
    return adapt("codex", input, this.capability.verified ? ["prompt"] : []);
  },
  respond(decision: PolicyDecision): HostResponse {
    if (decision.effect === "allow")
      return { continue: true, output: { permissionDecision: "allow" } };
    return {
      continue: false,
      output: {
        permissionDecision: "deny",
        permissionDecisionReason: denialMessage(decision.reason),
      },
      stderr: denialMessage(decision.reason),
    };
  },
};
