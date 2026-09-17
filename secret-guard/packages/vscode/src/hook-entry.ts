import process from "node:process";
import { dirname } from "node:path";
import { canDelegate, relayConnected } from "./gateway-delegation.js";
import { beginActivity } from "./hook-activity.js";

import { parseHookMode, runHook } from "@xsom/secret-guard-cli/hook";

const MAX_HOOK_INPUT_BYTES = 1_200_000;
const STALE_SESSION_MESSAGE =
  "🔌 Secret Guard · Session non raccordée\nLe relais xSOM nettoie automatiquement, mais cette session Claude a été ouverte avant le raccordement. Ouvrez une nouvelle session, puis renvoyez votre message.";

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

async function check(storage: string): Promise<void> {
  let rawInput = "";
  try {
    rawInput = await readBoundedStdin();
  } catch {
    // Empty input produces the protocol's fail-closed response.
  }
  const mode = parseHookMode(process.argv.slice(2));
  const response = runHook(rawInput, mode);
  // Prompts, their @-mentioned files and Read tool results all reach the
  // provider inside the request the relay cleans; nothing else is delegated.
  let relayedEvent = false;
  try {
    const input = JSON.parse(rawInput) as Record<string, unknown>;
    relayedEvent =
      (input.hook_event_name === "UserPromptSubmit" &&
        typeof input.prompt === "string") ||
      (input.hook_event_name === "PreToolUse" && input.tool_name === "Read");
  } catch {
    /* Invalid envelopes must remain blocked. */
  }
  if (
    !response.continue &&
    relayedEvent &&
    mode === "redact" &&
    (await canDelegate(storage, process.env.ANTHROPIC_BASE_URL))
  ) {
    // The original travels only to the registered, mandatory-redaction route.
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
    return;
  }
  if (!response.continue) {
    // Claude reads ANTHROPIC_BASE_URL once, when the session starts: a session
    // opened before the relay was connected can never delegate to it.
    const staleClaudeSession =
      relayedEvent &&
      mode === "redact" &&
      process.env.CLAUDE_PROJECT_DIR !== undefined &&
      (await relayConnected(storage));
    process.stderr.write(
      `${staleClaudeSession ? STALE_SESSION_MESSAGE : (response.stopReason ?? "Secret Guard blocked this prompt.")}\n`,
    );
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function main(): Promise<void> {
  // The installed hook lives in the extension's storage folder.
  const storage = dirname(process.argv[1] ?? "");
  const done = beginActivity(storage);
  try {
    await check(storage);
  } finally {
    done();
  }
}

void main();
