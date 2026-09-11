import { describe, expect, it } from "vitest";

import { responseForResult, runHook } from "../../packages/cli/src/hook.js";

const fakeToken = `ghp_${"aB3d".repeat(9)}`;

describe("hook bridge", () => {
  it("allows a clean prompt without echoing it", () => {
    const raw = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      prompt: "explain this",
    });
    const serialized = JSON.stringify(runHook(raw));
    expect(JSON.parse(serialized)).toEqual({ continue: true });
    expect(serialized).not.toContain("explain this");
  });

  it("blocks a strong finding with compatible fields and no raw value", () => {
    const response = runHook(JSON.stringify({ prompt: `use ${fakeToken}` }));
    const serialized = JSON.stringify(response);
    expect(response.continue).toBe(false);
    expect(response.stopReason).toContain("line 1");
    expect(serialized).not.toContain(fakeToken);
  });

  it("fails closed for malformed and missing prompt inputs", () => {
    expect(runHook("{").continue).toBe(false);
    expect(
      runHook(JSON.stringify({ hook_event_name: "UserPromptSubmit" })).continue,
    ).toBe(false);
  });

  it("fails closed when invoked for a different hook event", () => {
    const response = runHook(
      JSON.stringify({ hook_event_name: "PostToolUse", prompt: "clean" }),
    );

    expect(response).toMatchObject({ continue: false });
  });

  it("can explicitly surface a warning without blocking", () => {
    const result = {
      decision: "WARN" as const,
      level: "MEDIUM" as const,
      score: 35,
      complete: true,
      inputBytes: 32,
      rulesetVersion: "test",
      findings: [
        {
          ruleId: "entropy",
          secretType: "generic_secret" as const,
          score: 35,
          level: "MEDIUM" as const,
          span: {
            start: { offset: 0, line: 1, column: 1 },
            end: { offset: 32, line: 1, column: 33 },
          },
          reasons: ["high_entropy"],
          encoding: "plain" as const,
        },
      ],
    };
    expect(responseForResult(result, "allow")).toMatchObject({
      continue: true,
      systemMessage: expect.stringContaining("generic_secret") as string,
    });
    expect(responseForResult(result, "block").continue).toBe(false);
  });
});
