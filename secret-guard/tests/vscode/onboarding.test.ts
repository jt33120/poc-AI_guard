import { describe, expect, it } from "vitest";

import {
  activationStrategy,
  supportsVsCodePromptHooks,
} from "../../packages/vscode/src/onboarding.js";

describe("extension onboarding", () => {
  it("auto-enables an unconfigured production install", () => {
    expect(activationStrategy("off", true, false)).toBe("enable");
  });

  it.each([
    ["off", false, false],
    ["off", true, true],
    ["active", true, false],
    ["partial", true, false],
    ["degraded", true, false],
  ] as const)(
    "refreshes safely for state=%s autoEnable=%s extensionTest=%s",
    (state, autoEnable, extensionTest) => {
      expect(activationStrategy(state, autoEnable, extensionTest)).toBe(
        "refresh",
      );
    },
  );

  it.each([
    ["1.132.9", false],
    ["1.133.0", false],
    ["1.136.9", false],
    ["1.137.0", true],
    ["2.0.0", true],
    ["invalid", false],
  ] as const)("reports VS Code hook support for %s", (version, supported) => {
    expect(supportsVsCodePromptHooks(version)).toBe(supported);
  });
});
