import type { PolicyDecision } from "@xsom/developer-guard-policy";
import { adapt, denialMessage } from "./shared.js";
import type { HostAdapter, HostResponse, RawHookInput } from "./types.js";

export const copilotAdapter: HostAdapter = {
  capability: {
    assistant: "copilot",
    events: ["prompt"],
    protocol: "copilot",
    verified: false,
  },
  adapt(input: RawHookInput) {
    return adapt(
      "copilot",
      input,
      this.capability.verified ? this.capability.events : [],
    );
  },
  respond(decision: PolicyDecision): HostResponse {
    if (decision.effect === "allow")
      return { continue: true, output: { continue: true } };
    return {
      continue: false,
      output: { continue: false, stopReason: denialMessage(decision.reason) },
      stderr: denialMessage(decision.reason),
    };
  },
};
