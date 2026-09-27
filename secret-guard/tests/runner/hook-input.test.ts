import { describe, expect, it } from "vitest";
import { claudeAdapter } from "../../packages/adapters/src/index.js";
import { evaluateHookInput } from "../../packages/runner/src/index.js";

const policy = {
  schemaVersion: 1 as const,
  policyId: "team",
  version: 1,
  issuedAt: "2026-09-22T00:00:00Z",
  expiresAt: "2030-01-01T00:00:00Z",
  defaults: { unknownAction: "deny" as const },
  rules: [],
};

describe("runner hook boundary", () => {
  it("refuses a credential read before policy evaluation", () => {
    const result = evaluateHookInput(
      claudeAdapter,
      {
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "/repo/.env" },
      },
      policy,
      ["/repo"],
    );
    expect(result.decision).toMatchObject({
      effect: "deny",
      reason: "sensitive_resource",
    });
  });

  it("does not make prompts policy-controlled without an enrolled policy", () => {
    expect(
      evaluateHookInput(
        claudeAdapter,
        { hook_event_name: "UserPromptSubmit", prompt: "explain this" },
        undefined,
      ),
    ).toEqual({ ignored: true });
  });
});
