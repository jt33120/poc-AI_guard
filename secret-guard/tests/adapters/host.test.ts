import { describe, expect, it } from "vitest";
import {
  claudeAdapter,
  codexAdapter,
} from "../../packages/adapters/src/index.js";

describe("host adapters", () => {
  it("keeps native response shapes separate", () => {
    const denial = {
      effect: "deny" as const,
      reason: "policy_default",
      matchedRuleIds: [],
    };
    expect(claudeAdapter.respond(denial).output).toMatchObject({
      continue: false,
    });
    expect(codexAdapter.respond(denial).output).toMatchObject({
      permissionDecision: "deny",
    });
  });

  it("normalizes tool events without retaining tool arguments", () => {
    const event = codexAdapter.adapt({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git push", secret: "must-not-be-returned" },
    });
    expect(event?.request).toMatchObject({
      event: "command",
      actionClass: "publish",
      tool: "Bash",
    });
    expect(JSON.stringify(event)).not.toContain("must-not-be-returned");
    expect(event?.request.capabilityVerified).toBe(false);
  });
});
