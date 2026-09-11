import { scan, type ScanResult } from "@xsom/secret-guard-core";

import { hookMessage } from "./report.js";

export type WarnMode = "allow" | "block";

export interface HookResponse {
  readonly continue: boolean;
  readonly stopReason?: string;
  readonly systemMessage?: string;
}

interface HookInput {
  readonly hook_event_name?: unknown;
  readonly hookEventName?: unknown;
  readonly prompt?: unknown;
}

function block(reason: string): HookResponse {
  return {
    continue: false,
    stopReason: reason,
  };
}

export function responseForResult(
  result: ScanResult,
  warnMode: WarnMode,
): HookResponse {
  if (result.decision === "ALLOW" && result.complete) return { continue: true };

  const message = hookMessage(result);
  if (result.decision === "WARN" && result.complete && warnMode === "allow") {
    return { continue: true, systemMessage: message };
  }
  return block(message);
}

export function runHook(
  rawInput: string,
  warnMode: WarnMode = "block",
): HookResponse {
  let input: HookInput;
  try {
    input = JSON.parse(rawInput) as HookInput;
  } catch {
    return block("Secret Guard blocked because the hook input was invalid.");
  }

  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.prompt !== "string"
  ) {
    return block(
      "Secret Guard blocked because the hook did not provide a prompt.",
    );
  }

  const eventName = input.hook_event_name ?? input.hookEventName;
  if (eventName !== undefined && eventName !== "UserPromptSubmit") {
    return block("Secret Guard blocked an unexpected hook event.");
  }

  try {
    const result = scan({ content: input.prompt, sourceKind: "prompt" });
    return responseForResult(result, warnMode);
  } catch {
    return block("Secret Guard blocked because the local scanner failed.");
  }
}
