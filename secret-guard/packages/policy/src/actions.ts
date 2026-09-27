import type { ActionClass, PolicyEvent } from "./types.js";

const PUBLISH = /\b(git\s+push|npm\s+publish|twine\s+upload|gh\s+release)\b/i;
const DEPLOY =
  /\b(terraform\s+apply|kubectl\s+apply|vercel\s+deploy|railway\s+up|flyctl\s+deploy)\b/i;
const NETWORK = /\b(curl|wget|invoke-webrequest|ssh|scp|nc|netcat)\b/i;
const DELETE = /\b(rm\s+-[a-z]*r|del\s+\/|remove-item|git\s+clean)\b/i;

export function classifyAction(
  event: PolicyEvent,
  command?: string,
): ActionClass {
  if (event === "mcp") return "mcp";
  if (event === "network") return "network";
  if (event === "read") return "read";
  if (event === "write") return "write";
  if (event === "delete") return "delete";
  if (event !== "command" || command === undefined) return "unknown";
  if (DELETE.test(command)) return "delete";
  if (PUBLISH.test(command)) return "publish";
  if (DEPLOY.test(command)) return "deploy";
  if (NETWORK.test(command)) return "network";
  return "unknown";
}

export function commandIsAmbiguous(command: string): boolean {
  return /[`$][(]|\||&&|;|\n/.test(command);
}
