import { describe, expect, it } from "vitest";

import {
  activationStrategy,
  CODEX_ONBOARDING_REVISION,
  shouldOfferCodexFinalization,
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

  it("offers Codex finalization once for a ready first install", () => {
    expect(shouldOfferCodexFinalization("active", undefined, false)).toBe(true);
    expect(
      shouldOfferCodexFinalization("active", CODEX_ONBOARDING_REVISION, false),
    ).toBe(false);
  });

  it.each(["off", "degraded"] as const)(
    "does not offer finalization while hook health is %s",
    (state) => {
      expect(shouldOfferCodexFinalization(state, undefined, false)).toBe(false);
    },
  );

  it("does not open onboarding UI in extension-host tests", () => {
    expect(shouldOfferCodexFinalization("active", undefined, true)).toBe(false);
  });

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
