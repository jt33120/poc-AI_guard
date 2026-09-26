import type { PolicyEvent } from "./types.js";

const EXACT_TOOLS: Readonly<Record<string, PolicyEvent>> = {
  read: "read",
  write: "write",
  edit: "write",
  apply_patch: "write",
  delete: "delete",
  remove: "delete",
  bash: "command",
  shell: "command",
  terminal: "command",
  command: "command",
};

export function registeredToolEvent(tool: string | undefined): PolicyEvent {
  if (tool === undefined) return "unknown";
  const normalized = tool.trim().toLowerCase();
  if (normalized.startsWith("mcp__") || normalized.startsWith("mcp."))
    return "mcp";
  return EXACT_TOOLS[normalized] ?? "unknown";
}
