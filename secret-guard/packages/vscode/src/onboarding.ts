import type { HookHealthState } from "./hook-manager.js";

export type ActivationStrategy = "enable" | "refresh";

export const CODEX_ONBOARDING_REVISION = 1;

export function supportsVsCodePromptHooks(version: string): boolean {
  const match = /^(\d+)\.(\d+)/u.exec(version);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 137);
}

export function activationStrategy(
  state: HookHealthState,
  autoEnable: boolean,
  extensionTest: boolean,
): ActivationStrategy {
  if (state === "off" && autoEnable && !extensionTest) return "enable";
  return "refresh";
}

export function shouldOfferCodexFinalization(
  state: HookHealthState,
  completedRevision: number | undefined,
  extensionTest: boolean,
): boolean {
  return (
    !extensionTest &&
    (state === "active" || state === "partial") &&
    completedRevision !== CODEX_ONBOARDING_REVISION
  );
}
