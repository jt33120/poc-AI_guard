import { basename, resolve } from "node:path";
import process from "node:process";

import {
  CUSTOM_RULES_WORK_BUDGET,
  scan,
  WorkMeter,
  type CompiledRulesPack,
  type ScanResult,
} from "@xsom/secret-guard-core";

import {
  MAX_MENTIONED_FILES,
  mentionedPaths,
  readLocalFile,
  type FileReader,
  type FileText,
} from "./file-guard.js";
import { findingName, findingSummary, hookMessage } from "./report.js";

export type ProtectionMode = "block" | "redact" | "observe";
// Hook arguments written before 0.6 could also say "allow" (ambiguous
// findings passed). Such commands are still recognised so they can be
// replaced, but they now run as "block".
export type WarnMode = ProtectionMode | "allow";

export function parseHookMode(args: readonly string[]): ProtectionMode {
  const mode = args.find((value) => value.startsWith("--mode="));
  if (mode !== undefined) {
    const value = mode.slice("--mode=".length);
    return value === "observe" || value === "redact" ? value : "block";
  }
  return "block";
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

/** Sees every scan result of one hook decision (metadata only). */
export type ScanObserver = (result: ScanResult) => void;

/** The tuning of one hook decision, with the budget all its scans share. */
interface Tuning {
  readonly rules: CompiledRulesPack;
  readonly meter: WorkMeter;
}

function tuningFor(rules: CompiledRulesPack | undefined): Tuning | undefined {
  // One budget for the prompt and every file it mentions: the hook answers
  // well before the host's timeout, whatever the number of files.
  return rules === undefined
    ? undefined
    : { rules, meter: new WorkMeter(CUSTOM_RULES_WORK_BUDGET) };
}

function tuningInput(tuning: Tuning | undefined): {
  rules?: CompiledRulesPack;
  workMeter?: WorkMeter;
} {
  return tuning === undefined
    ? {}
    : { rules: tuning.rules, workMeter: tuning.meter };
}

function fileVerdict(
  file: FileText,
  tuning?: Tuning,
  observe?: ScanObserver,
): ScanResult | undefined {
  if (file.status !== "text") return undefined;
  try {
    const result = scan({
      content: file.content,
      sourceKind: "document",
      ...tuningInput(tuning),
    });
    observe?.(result);
    return result;
  } catch {
    return undefined;
  }
}

function fileDetail(name: string, result: ScanResult | undefined): string {
  const first = result?.findings[0];
  if (result === undefined || !result.complete || first === undefined)
    return `Secret Guard n’a pas pu analyser « ${name} » en entier : fichier binaire, de plus de 1 Mio, inaccessible ou analyse trop longue.`;
  const extra =
    result.findings.length > 1
      ? ` et ${String(result.findings.length - 1)} autre(s) détection(s)`
      : "";
  return `« ${name} » contient ${findingName(first)} ligne ${String(first.span.start.line)}${extra}. La valeur n’est pas affichée.`;
}

/**
 * The verdict for one file whose content would reach the model. Hosts cannot
 * rewrite a file as they read it, so redact mode blocks like block mode unless
 * the xSOM relay takes over (see the VS Code hook entry).
 */
export function fileResponse(
  path: string,
  mode: ProtectionMode,
  readFile: FileReader = readLocalFile,
  rules?: CompiledRulesPack,
  observe?: ScanObserver,
): HookResponse {
  return tunedFileResponse(path, mode, readFile, tuningFor(rules), observe);
}

function tunedFileResponse(
  path: string,
  mode: ProtectionMode,
  readFile: FileReader,
  tuning: Tuning | undefined,
  observe?: ScanObserver,
): HookResponse {
  const file = readSafely(readFile, path);
  if (file.status === "absent") return { continue: true };
  const result = fileVerdict(file, tuning, observe);
  if (result?.decision === "ALLOW" && result.complete)
    return { continue: true };
  const detail = fileDetail(basename(path), result);
  if (mode === "observe")
    return {
      continue: true,
      systemMessage: `👁️ Secret Guard · Avertir et laisser passer\n${detail}\nLe fichier est transmis sans modification.`,
    };
  const advice =
    mode === "redact"
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
  mode: ProtectionMode,
  readFile: FileReader,
  tuning?: Tuning,
  observe?: ScanObserver,
): HookResponse {
  const paths = mentionedPaths(prompt, cwd);
  const checked = paths
    .slice(0, MAX_MENTIONED_FILES)
    .map((path) => tunedFileResponse(path, mode, readFile, tuning, observe));
  if (paths.length > MAX_MENTIONED_FILES && mode !== "observe")
    checked.push(
      block(
        `🔒 Secret Guard · Trop de fichiers mentionnés\nAu-delà de ${String(MAX_MENTIONED_FILES)} mentions @, les fichiers ne sont pas tous vérifiés.`,
      ),
    );
  return combine(checked);
}

export function responseForResult(
  result: ScanResult,
  mode: ProtectionMode,
): HookResponse {
  if (result.decision === "ALLOW" && result.complete) return { continue: true };

  const message = hookMessage(result);
  if (mode === "observe") {
    return {
      continue: true,
      systemMessage: `👁️ Secret Guard · Avertir et laisser passer\n${result.complete ? "Contenu sensible détecté." : "Analyse incomplète."} Le texte original est transmis sans modification.\n${message}`,
    };
  }
  if (mode === "redact") {
    return block(
      `🧹 Secret Guard · Message non envoyé\n${findingSummary(result)}\nCopiez votre message puis cliquez sur Secret Guard dans la barre d’état de VS Code : le presse-papiers est expurgé. Collez-le (Ctrl+V) et renvoyez.\nLes valeurs détectées ne sont pas affichées.`,
    );
  }
  return block(message);
}

/**
 * Decide on one hook event. `rules` is an xSOM rules pack the caller has
 * already verified (signature, tenant, version); its detections add to the
 * built-in ones.
 */
export function runHook(
  rawInput: string,
  mode: ProtectionMode = "block",
  readFile: FileReader = readLocalFile,
  rules?: CompiledRulesPack,
  observe?: ScanObserver,
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
  const tuning = tuningFor(rules);
  if (subject.kind === "read")
    return tunedFileResponse(subject.path, mode, readFile, tuning, observe);

  try {
    const result = scan({
      content: subject.prompt,
      sourceKind: "prompt",
      ...tuningInput(tuning),
    });
    observe?.(result);
    return combine([
      responseForResult(result, mode),
      mentionedFilesResponse(
        subject.prompt,
        subject.cwd,
        mode,
        readFile,
        tuning,
        observe,
      ),
    ]);
  } catch {
    if (mode === "observe") {
      return {
        continue: true,
        systemMessage:
          "👁️ Secret Guard · Analyse indisponible. Le mode Avertir laisse passer le texte original sans modification.",
      };
    }
    return block("Secret Guard blocked because the local scanner failed.");
  }
}
