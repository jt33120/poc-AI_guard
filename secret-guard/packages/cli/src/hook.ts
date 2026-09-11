import { scan, type ScanResult } from "@xsom/secret-guard-core";

import { hookMessage } from "./report.js";

export type WarnMode = "allow" | "block";

export interface HookResponse {
  readonly continue: boolean;
  readonly stopReason?: string;
  readonly systemMessage?: string;
}

interface HookInput {
  readonly agent_action_name?: unknown;
  readonly hook_event_name?: unknown;
  readonly hookEventName?: unknown;
  readonly prompt?: unknown;
  readonly tool_info?: unknown;
}

interface ExtractedPrompt {
  readonly host: "windsurf" | "user-prompt-submit";
  readonly prompt: string;
}

function block(reason: string): HookResponse {
  return {
    continue: false,
    stopReason: reason,
  };
}

function extractPrompt(input: HookInput): ExtractedPrompt | null {
  if (input.agent_action_name !== undefined) {
    if (input.agent_action_name !== "pre_user_prompt") return null;
    if (
      typeof input.tool_info !== "object" ||
      input.tool_info === null ||
      !("user_prompt" in input.tool_info) ||
      typeof input.tool_info.user_prompt !== "string"
    ) {
      return null;
    }
    return { host: "windsurf", prompt: input.tool_info.user_prompt };
  }

  const eventName = input.hook_event_name ?? input.hookEventName;
  if (eventName !== undefined && eventName !== "UserPromptSubmit") return null;
  return typeof input.prompt === "string"
    ? { host: "user-prompt-submit", prompt: input.prompt }
    : null;
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

  if (typeof input !== "object" || input === null) {
    return block(
      "Secret Guard blocked because the hook did not provide a prompt.",
    );
  }

  const extracted = extractPrompt(input);
  if (extracted === null)
    return block("Secret Guard blocked an unexpected or invalid hook event.");

  try {
    const result = scan({ content: extracted.prompt, sourceKind: "prompt" });
    return responseForResult(result, warnMode);
  } catch {
    return block("Secret Guard blocked because the local scanner failed.");
  }
}
