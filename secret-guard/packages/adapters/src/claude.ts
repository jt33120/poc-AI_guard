import type { PolicyDecision } from "@xsom/developer-guard-policy";
import { adapt, denialMessage } from "./shared.js";
import type { HostAdapter, HostResponse, RawHookInput } from "./types.js";

export const claudeAdapter: HostAdapter = {
  capability: {
    assistant: "claude",
    events: ["prompt", "read"],
    protocol: "claude",
    verified: true,
  },
  adapt(input: RawHookInput) {
    return adapt(
      "claude",
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
