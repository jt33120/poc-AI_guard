import { scan, type ScanResult } from "@xsom/secret-guard-core";

import { hookMessage } from "./report.js";

export type ProtectionMode = "block" | "redact" | "observe";
// "allow" preserves the older policy: only ambiguous findings may pass.
export type WarnMode = ProtectionMode | "allow";

export function parseHookMode(args: readonly string[]): WarnMode {
  const mode = args.find((value) => value.startsWith("--mode="));
  if (mode !== undefined) {
    const value = mode.slice("--mode=".length);
    return value === "observe" || value === "redact" ? value : "block";
  }
  return args.includes("--warn=allow") ? "allow" : "block";
}

export function hookModeArgument(mode: WarnMode): string {
  return mode === "observe" || mode === "redact"
    ? `--mode=${mode}`
    : `--warn=${mode}`;
}

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
  if (warnMode === "observe") {
    return {
      continue: true,
      systemMessage: `👁️ Secret Guard · Avertir et laisser passer\n${result.complete ? "Contenu sensible détecté." : "Analyse incomplète."} Le texte original est transmis sans modification.\n${message}`,
    };
  }
  if (warnMode === "redact") {
    return block(
      `🧹 Secret Guard · Nettoyage nécessaire\nCet assistant ne permet pas à Secret Guard de remplacer votre message automatiquement. Copiez votre message, puis cliquez sur Secret Guard → Vérifier le presse-papiers → Copier la version expurgée. Collez cette version et renvoyez-la.\n${message}`,
    );
  }
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
    if (warnMode === "observe") {
      return {
        continue: true,
        systemMessage:
          "👁️ Secret Guard · Analyse indisponible. Le mode Avertir laisse passer le texte original sans modification.",
      };
    }
    return block("Secret Guard blocked because the local scanner failed.");
  }
}
