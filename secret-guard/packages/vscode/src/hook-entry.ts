import process from "node:process";
import { dirname } from "node:path";
import { canDelegate } from "./gateway-delegation.js";

import { parseHookMode, runHook } from "@xsom/secret-guard-cli/hook";

const MAX_HOOK_INPUT_BYTES = 1_200_000;

async function readBoundedStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > MAX_HOOK_INPUT_BYTES) return "";
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  let rawInput = "";
  try {
    rawInput = await readBoundedStdin();
  } catch {
    // Empty input produces the protocol's fail-closed response.
  }
  const mode = parseHookMode(process.argv.slice(2));
  const response = runHook(rawInput, mode);
  let promptEvent = false;
  try {
    const input = JSON.parse(rawInput) as Record<string, unknown>;
    promptEvent =
      input.hook_event_name === "UserPromptSubmit" &&
      typeof input.prompt === "string";
  } catch {
    /* Invalid envelopes must remain blocked. */
  }
  if (
    !response.continue &&
    promptEvent &&
    mode === "redact" &&
    (await canDelegate(
      dirname(process.argv[1] ?? ""),
      process.env.ANTHROPIC_BASE_URL,
    ))
  ) {
    // The original travels only to the registered, mandatory-redaction route.
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
    return;
  }
  if (!response.continue) {
    process.stderr.write(
      `${response.stopReason ?? "Secret Guard blocked this prompt."}\n`,
    );
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

void main();
