import { basename, resolve } from "node:path";
import process from "node:process";

import { scan, type ScanResult } from "@xsom/secret-guard-core";

import {
  MAX_MENTIONED_FILES,
  mentionedPaths,
  readLocalFile,
  type FileReader,
  type FileText,
} from "./file-guard.js";
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
  readonly hook_event_name?: unknown;
  readonly hookEventName?: unknown;
  readonly prompt?: unknown;
  readonly tool_name?: unknown;
  readonly tool_input?: unknown;
  readonly cwd?: unknown;
}

// A prompt, with the files it @-mentions, or a file the assistant is about to
// read with its Read tool (Claude Code PreToolUse).
type HookSubject =
  | { readonly kind: "prompt"; readonly prompt: string; readonly cwd: string }
  | { readonly kind: "read"; readonly path: string };

function block(reason: string): HookResponse {
  return {
    continue: false,
    stopReason: reason,
  };
}

function hookSubject(input: HookInput): HookSubject | null {
  const eventName = input.hook_event_name ?? input.hookEventName;
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  if (eventName === "PreToolUse") {
    if (input.tool_name !== "Read") return null;
    const toolInput = input.tool_input;
    if (typeof toolInput !== "object" || toolInput === null) return null;
    const path = (toolInput as { readonly file_path?: unknown }).file_path;
    return typeof path === "string" && path !== ""
      ? { kind: "read", path: resolve(cwd, path) }
      : null;
  }
  if (eventName !== undefined && eventName !== "UserPromptSubmit") return null;
  return typeof input.prompt === "string"
    ? { kind: "prompt", prompt: input.prompt, cwd }
    : null;
}

function readSafely(readFile: FileReader, path: string): FileText {
  try {
    return readFile(path);
  } catch {
    return { status: "unreadable" };
  }
}

function fileVerdict(file: FileText): ScanResult | undefined {
  if (file.status !== "text") return undefined;
  try {
    return scan({ content: file.content, sourceKind: "document" });
  } catch {
    return undefined;
  }
}

function fileDetail(name: string, result: ScanResult | undefined): string {
  const first = result?.findings[0];
  if (result === undefined || !result.complete || first === undefined)
    return `Secret Guard n’a pas pu analyser « ${name} » en entier : fichier binaire, de plus de 1 Mio ou inaccessible.`;
  const extra =
    result.findings.length > 1
      ? ` et ${String(result.findings.length - 1)} autre(s) détection(s)`
      : "";
  return `« ${name} » contient ${first.secretType} ligne ${String(first.span.start.line)}${extra}. La valeur n’est pas affichée.`;
}

/**
 * The verdict for one file whose content would reach the model. Hosts cannot
 * rewrite a file as they read it, so redact mode blocks like block mode unless
 * the xSOM relay takes over (see the VS Code hook entry).
 */
export function fileResponse(
  path: string,
  warnMode: WarnMode,
  readFile: FileReader = readLocalFile,
): HookResponse {
  const file = readSafely(readFile, path);
  if (file.status === "absent") return { continue: true };
  const result = fileVerdict(file);
  if (result?.decision === "ALLOW" && result.complete)
    return { continue: true };
  const detail = fileDetail(basename(path), result);
  if (warnMode === "observe")
    return {
      continue: true,
      systemMessage: `👁️ Secret Guard · Avertir et laisser passer\n${detail}\nLe fichier est transmis sans modification.`,
    };
  if (
    result?.complete === true &&
    result.decision === "WARN" &&
    warnMode === "allow"
  )
    return { continue: true, systemMessage: detail };
  const advice =
    warnMode === "redact"
      ? "Cet assistant ne permet pas à Secret Guard de nettoyer un fichier : retirez la valeur, ou raccordez le relais xSOM pour un nettoyage automatique."
      : "Retirez la valeur du fichier avant de le partager.";
  return block(
    `🔒 Secret Guard · Fichier bloqué\n${detail}\n${advice}\nAssistant : ne lisez pas ce fichier par un autre moyen (shell, recherche) ; signalez le blocage à l’utilisateur.`,
  );
}

function combine(responses: readonly HookResponse[]): HookResponse {
  const blocked = responses.find((response) => !response.continue);
  if (blocked !== undefined) return blocked;
  const messages = responses.flatMap((response) =>
    response.systemMessage === undefined ? [] : [response.systemMessage],
  );
  return messages.length === 0
    ? { continue: true }
    : { continue: true, systemMessage: messages.join("\n\n") };
}

function mentionedFilesResponse(
  prompt: string,
  cwd: string,
  warnMode: WarnMode,
  readFile: FileReader,
): HookResponse {
  const paths = mentionedPaths(prompt, cwd);
  const checked = paths
    .slice(0, MAX_MENTIONED_FILES)
    .map((path) => fileResponse(path, warnMode, readFile));
  if (paths.length > MAX_MENTIONED_FILES && warnMode !== "observe")
    checked.push(
      block(
        `🔒 Secret Guard · Trop de fichiers mentionnés\nAu-delà de ${String(MAX_MENTIONED_FILES)} mentions @, les fichiers ne sont pas tous vérifiés.`,
      ),
    );
  return combine(checked);
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
  readFile: FileReader = readLocalFile,
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

  const subject = hookSubject(input);
  if (subject === null)
    return block("Secret Guard blocked an unexpected or invalid hook event.");
  if (subject.kind === "read")
    return fileResponse(subject.path, warnMode, readFile);

  try {
    const result = scan({ content: subject.prompt, sourceKind: "prompt" });
    return combine([
      responseForResult(result, warnMode),
      mentionedFilesResponse(subject.prompt, subject.cwd, warnMode, readFile),
    ]);
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
