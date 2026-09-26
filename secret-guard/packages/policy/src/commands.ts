import { classifyAction, commandIsAmbiguous } from "./actions.js";
import type { ActionClass } from "./types.js";

const INTERPRETER =
  /(?:^|\s)(?:python|python3|node|ruby|perl|php|sh|bash|zsh|pwsh|powershell)(?:\s|$)/i;
const INLINE_CODE = /(?:^|\s)(?:-c|-e|--eval)(?:\s|$)/i;
const PTY = /(?:^|\s)(?:script|expect|unbuffer|socat)(?:\s|$)/i;
const SECURITY =
  /\b(?:chmod|chown|setfacl|icacls|reg\s+add|defaults\s+write|security\s+add-)\b/i;

export interface CommandDecision {
  readonly actionClass: ActionClass;
  readonly analyzable: boolean;
  readonly reason?:
    "compound_command" | "inline_interpreter" | "interactive_terminal";
}

export function analyzeCommand(command: string): CommandDecision {
  if (commandIsAmbiguous(command))
    return {
      actionClass: "unknown",
      analyzable: false,
      reason: "compound_command",
    };
  if (PTY.test(command))
    return {
      actionClass: "unknown",
      analyzable: false,
      reason: "interactive_terminal",
    };
  if (INTERPRETER.test(command) && INLINE_CODE.test(command))
    return {
      actionClass: "unknown",
      analyzable: false,
      reason: "inline_interpreter",
    };
  if (SECURITY.test(command))
    return { actionClass: "security", analyzable: true };
  return { actionClass: classifyAction("command", command), analyzable: true };
}
