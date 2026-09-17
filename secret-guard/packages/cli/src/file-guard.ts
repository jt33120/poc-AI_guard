import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { decodeScannableText, MAX_INPUT_BYTES } from "@xsom/secret-guard-core";

export type FileText =
  | { readonly status: "text"; readonly content: string }
  // Nothing to read: the assistant's own read fails without disclosing data.
  | { readonly status: "absent" }
  // Binary, over the scan limit or not accessible: never a clean verdict.
  | { readonly status: "unreadable" };

export type FileReader = (path: string) => FileText;

export const MAX_MENTIONED_FILES = 20;

function isAbsent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

export function readLocalFile(path: string): FileText {
  try {
    const metadata = statSync(path);
    if (!metadata.isFile()) return { status: "absent" };
    if (metadata.size > MAX_INPUT_BYTES) return { status: "unreadable" };
    const content = decodeScannableText(readFileSync(path));
    return content === undefined
      ? { status: "unreadable" }
      : { status: "text", content };
  } catch (error) {
    return isAbsent(error) ? { status: "absent" } : { status: "unreadable" };
  }
}

// `@path`, `@"path with spaces"` and `@path#L10-20` as typed in assistant
// prompts. A mention must start the prompt or follow whitespace, so e-mail
// addresses are ignored; tokens that name no file resolve as absent.
export function mentionedPaths(prompt: string, cwd: string): string[] {
  const paths = new Set<string>();
  for (const match of prompt.matchAll(/(?:^|\s)@(?:"([^"]+)"|(\S+))/gu)) {
    const token = match[1] ?? match[2] ?? "";
    const path = token
      .replace(/#L\d+(?:-\d+)?$/u, "")
      .replace(/[,;:!?)]+$/u, "");
    if (path !== "") paths.add(resolve(cwd, path));
  }
  return [...paths];
}
