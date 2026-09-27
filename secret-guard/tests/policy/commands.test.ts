import { describe, expect, it } from "vitest";
import {
  analyzeCommand,
  evaluateData,
  evaluateResource,
  registeredToolEvent,
} from "../../packages/policy/src/index.js";

describe("command and data policy", () => {
  it("classifies direct actions and refuses to infer compound or interpreter behavior", () => {
    expect(analyzeCommand("git push origin main")).toMatchObject({
      actionClass: "publish",
      analyzable: true,
    });
    expect(analyzeCommand("kubectl apply -f app.yaml")).toMatchObject({
      actionClass: "deploy",
    });
    expect(analyzeCommand("git status && curl example.test")).toMatchObject({
      actionClass: "unknown",
      analyzable: false,
      reason: "compound_command",
    });
    expect(analyzeCommand("python -c 'print(1)'")).toMatchObject({
      analyzable: false,
      reason: "inline_interpreter",
    });
    expect(analyzeCommand("script -q session.log")).toMatchObject({
      analyzable: false,
      reason: "interactive_terminal",
    });
  });

  it("uses an exact tool registry and handles Windows roots and binary limits", () => {
    expect(registeredToolEvent("Read")).toBe("read");
    expect(registeredToolEvent("mcp__github__create_issue")).toBe("mcp");
    expect(registeredToolEvent("ReadEverything")).toBe("unknown");
    expect(evaluateResource("C:\\repo\\src\\a.ts", ["c:\\repo"])).toMatchObject(
      {
        allowed: true,
      },
    );
    expect(
      evaluateResource("C:\\Users\\me\\.env", ["C:\\Users\\me"]),
    ).toMatchObject({
      allowed: false,
      reason: "sensitive_resource",
    });
    expect(evaluateData(2, Uint8Array.from([65, 0]))).toMatchObject({
      allowed: false,
      reason: "binary_content",
    });
    expect(evaluateData(2_000_000, Uint8Array.from([65]))).toMatchObject({
      allowed: false,
      reason: "file_too_large",
    });
  });
});
