import {
  lstatSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, sep } from "node:path";
import process from "node:process";

import {
  decodeScannableText,
  findHidden,
  hiddenKindLabel,
  MAX_INPUT_BYTES,
  stripHidden,
  type HiddenFinding,
  type HiddenReport,
} from "@xsom/secret-guard-core";

/** "contient 28 caractères invisibles — étiquettes Unicode…, dès la ligne 3" */
export function hiddenSummary(report: HiddenReport): string {
  const kinds = [...new Set(report.findings.map((f) => f.kind))]
    .map(hiddenKindLabel)
    .join(", ");
  const first = report.findings[0];
  const where =
    first === undefined
      ? ""
      : `, dès la ligne ${String(first.line)}, colonne ${String(first.column)}`;
  const count =
    report.hidden > 1
      ? `${String(report.hidden)} caractères invisibles`
      : `${String(report.hidden)} caractère invisible`;
  return `contient ${count} (${kinds})${where} : des consignes que vous ne voyez pas peuvent y être cachées. Leur contenu n’est pas affiché.`;
}

// The files an assistant loads as instructions, often without asking: the
// "Rules File Backdoor" hides its payload in exactly these.
const INSTRUCTION_NAMES = new Set([
  "agents.md",
  "claude.md",
  "claude.local.md",
  "gemini.md",
  "conventions.md",
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
  ".roorules",
  "copilot-instructions.md",
  ".mcp.json",
  "mcp.json",
]);
const INSTRUCTION_SUFFIXES = [
  ".instructions.md",
  ".prompt.md",
  ".chatmode.md",
  ".mdc",
];
const INSTRUCTION_FOLDERS = [
  [".claude"],
  [".cursor", "rules"],
  [".clinerules"],
  [".github", "instructions"],
  [".github", "prompts"],
  [".github", "chatmodes"],
];
const SKIPPED_FOLDERS = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "dist",
  "build",
  "target",
  "vendor",
  "coverage",
  ".next",
]);
const MAX_DEPTH = 8;
const MAX_VISITED = 20_000;
const MAX_FILES = 500;

export function isInstructionFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  if (INSTRUCTION_NAMES.has(name)) return true;
  if (INSTRUCTION_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  const parts = path.split(sep);
  return INSTRUCTION_FOLDERS.some((folder) =>
    parts.some((_, index) =>
      folder.every((segment, offset) => parts[index + offset] === segment),
    ),
  );
}

/** Regular files under `root`, bounded, symlinks never followed. */
export function walk(
  root: string,
  keep: (path: string) => boolean,
): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  let visited = 0;
  let truncated = false;
  const visit = (folder: string, depth: number) => {
    if (depth > MAX_DEPTH || truncated) return;
    let entries: string[];
    try {
      entries = readdirSync(folder).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_VISITED || files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const path = join(folder, entry);
      let kind;
      try {
        kind = lstatSync(path);
      } catch {
        continue;
      }
      if (kind.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry)) visit(path, depth + 1);
      } else if (kind.isFile() && keep(relative(root, path))) files.push(path);
    }
  };
  visit(root, 0);
  return { files, truncated };
}

export type FileCheck =
  | { readonly path: string; readonly status: "clean" }
  | {
      readonly path: string;
      readonly status: "hidden";
      readonly hidden: number;
      readonly findings: readonly HiddenFinding[];
    }
  | { readonly path: string; readonly status: "unreadable" };

export function checkFile(path: string): FileCheck {
  try {
    if (statSync(path).size > MAX_INPUT_BYTES)
      return { path, status: "unreadable" };
    const text = decodeScannableText(readFileSync(path));
    if (text === undefined) return { path, status: "unreadable" };
    const report = findHidden(text);
    if (!report.complete) return { path, status: "unreadable" };
    return report.hidden === 0
      ? { path, status: "clean" }
      : {
          path,
          status: "hidden",
          hidden: report.hidden,
          findings: report.findings,
        };
  } catch {
    return { path, status: "unreadable" };
  }
}

/** Rewrite `path` without its hidden characters, atomically. */
export function fixFile(path: string): number {
  const text = decodeScannableText(readFileSync(path));
  if (text === undefined) throw new Error("unreadable");
  const stripped = stripHidden(text);
  if (!stripped.complete) throw new Error("incomplete");
  if (stripped.removed === 0) return 0;
  const temporary = `${path}.secret-guard-${String(process.pid)}`;
  writeFileSync(temporary, stripped.text, { mode: statSync(path).mode });
  renameSync(temporary, path);
  return stripped.removed;
}
