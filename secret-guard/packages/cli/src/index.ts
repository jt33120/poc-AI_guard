#!/usr/bin/env node

import { open } from "node:fs/promises";
import { basename, extname } from "node:path";
import process from "node:process";

import {
  MAX_INPUT_BYTES,
  redactAndRescan,
  scan,
} from "@xsom/secret-guard-core";

import { runHook, type WarnMode } from "./hook.js";
import { humanReport } from "./report.js";

const MAX_STDIN_BYTES = 1_200_000;

class UsageError extends Error {}

interface BoundedInput {
  readonly content: string;
  readonly truncated: boolean;
}

async function readStdin(maximumBytes: number): Promise<BoundedInput> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const remaining = maximumBytes - size;
    if (bytes.length > remaining) {
      if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
      return {
        content: Buffer.concat(chunks).toString("utf8"),
        truncated: true,
      };
    }
    chunks.push(bytes);
    size += bytes.length;
  }
  return { content: Buffer.concat(chunks).toString("utf8"), truncated: false };
}

async function readFileBounded(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset).toString("utf8");
  } finally {
    await handle.close();
  }
}

function exitCode(decision: "ALLOW" | "WARN" | "BLOCK"): number {
  if (decision === "ALLOW") return 0;
  return decision === "WARN" ? 1 : 2;
}

async function scanCommand(args: readonly string[]): Promise<number> {
  const json = args.includes("--json");
  const shouldRedact = args.includes("--redact");
  const options = args.filter((arg) => arg.startsWith("--"));
  if (options.some((option) => option !== "--json" && option !== "--redact"))
    throw new UsageError("scan received an unknown option");
  if (json && shouldRedact)
    throw new UsageError("--json and --redact are mutually exclusive");
  const paths = args.filter((arg) => !arg.startsWith("--"));
  if (paths.length > 1)
    throw new UsageError("scan accepts at most one file path");
  const path = paths[0] ?? "-";
  const content =
    path === "-"
      ? (await readStdin(MAX_INPUT_BYTES + 1)).content
      : await readFileBounded(path);
  const languageId =
    path === "-"
      ? undefined
      : basename(path).startsWith(".env")
        ? "dotenv"
        : extname(path).slice(1);
  const result = scan({
    content,
    sourceKind: path === "-" ? "text" : "document",
    ...(languageId === undefined ? {} : { languageId }),
  });

  if (shouldRedact) {
    if (!result.complete) {
      process.stderr.write(
        "Secret Guard refused to redact an incomplete scan.\n",
      );
      return 2;
    }
    const sanitized = redactAndRescan({
      content,
      sourceKind: path === "-" ? "text" : "document",
      ...(languageId === undefined ? {} : { languageId }),
    });
    if (
      !sanitized.final.complete ||
      sanitized.final.decision !== "ALLOW" ||
      sanitized.final.findings.length > 0
    ) {
      process.stderr.write(
        "Secret Guard refused to output content that did not rescan cleanly.\n",
      );
      return 2;
    }
    process.stdout.write(sanitized.content);
  } else if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(`${humanReport(result)}\n`);
  }
  return exitCode(result.decision);
}

function warnMode(args: readonly string[]): WarnMode {
  const option = args.find((arg) => arg.startsWith("--warn="));
  if (option === undefined || option === "--warn=block") return "block";
  if (option === "--warn=allow") return "allow";
  throw new UsageError("--warn must be block or allow");
}

async function hookCommand(args: readonly string[]): Promise<number> {
  let raw: string;
  try {
    const input = await readStdin(MAX_STDIN_BYTES);
    raw = input.truncated ? "" : input.content;
  } catch {
    raw = "";
  }
  const response = runHook(raw, warnMode(args));
  if (!response.continue) {
    process.stderr.write(
      `${response.stopReason ?? "Secret Guard blocked this prompt."}\n`,
    );
    return 2;
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
  return 0;
}

function usage(): string {
  return [
    "Usage:",
    "  secret-guard scan [--json|--redact] [file|-]",
    "  secret-guard hook [--warn=block|allow]",
    "",
    "Exit codes: scan uses 0 allow, 1 warn, 2 block; hook uses 0 allow or 2 block.",
  ].join("\n");
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "scan") return scanCommand(args);
  if (command === "hook") return hookCommand(args);
  if (command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  throw new UsageError(
    command === undefined ? usage() : `Unknown command.\n${usage()}`,
  );
}

try {
  process.exitCode = await main();
} catch (error) {
  const message =
    error instanceof UsageError ? error.message : "Secret Guard failed safely.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 64;
}
