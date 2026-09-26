import {
  analyzeCommand,
  registeredToolEvent,
  type ActionRequest,
  type Assistant,
  type PolicyEvent,
} from "@xsom/developer-guard-policy";
import type { AdaptedHook, RawHookInput } from "./types.js";

function stringField(...values: readonly unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

export function eventFor(input: RawHookInput): PolicyEvent {
  const event = stringField(input.hook_event_name, input.hookEventName);
  if (event === "UserPromptSubmit") return "prompt";
  if (event !== "PreToolUse") return "unknown";
  return registeredToolEvent(stringField(input.tool_name, input.toolName));
}

export function adapt(
  assistant: Assistant,
  input: RawHookInput,
  verifiedEvents: readonly PolicyEvent[],
): AdaptedHook | null {
  const event = eventFor(input);
  if (event === "unknown") return null;
  const tool = stringField(input.tool_name, input.toolName);
  const rawToolInput = input.tool_input ?? input.toolInput;
  const toolInput =
    typeof rawToolInput === "object" && rawToolInput !== null
      ? (rawToolInput as Record<string, unknown>)
      : undefined;
  const path =
    toolInput && typeof toolInput.file_path === "string"
      ? toolInput.file_path
      : undefined;
  const command = stringField(
    input.command,
    toolInput?.command,
    toolInput?.cmd,
  );
  const prompt = stringField(input.prompt);
  const request: ActionRequest = {
    assistant,
    event,
    actionClass:
      event === "command"
        ? analyzeCommand(command ?? "").actionClass
        : event === "read"
          ? "read"
          : event === "write"
            ? "write"
            : event === "delete"
              ? "delete"
              : event === "mcp"
                ? "mcp"
                : "unknown",
    capabilityVerified: verifiedEvents.includes(event),
    ...(path === undefined ? {} : { resource: path }),
    ...(tool === undefined ? {} : { tool }),
  };
  return {
    request,
    ...(prompt === undefined ? {} : { prompt }),
    ...(path === undefined ? {} : { path }),
  };
}

export function denialMessage(reason: string): string {
  return `xSOM Secret Guard refused this action (${reason}). No action was performed.`;
}
