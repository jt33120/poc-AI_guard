import process from "node:process";
import { dirname } from "node:path";
import { parseHookMode, runHook } from "@xsom/secret-guard-cli/hook";
import type { ScanResult } from "@xsom/secret-guard-core";
import { beginActivity } from "./hook-activity.js";
import { effectiveMode, readObserveDeadline } from "./observe-window.js";
import { NO_HOOK_TEAM, type HookTeam } from "./team-port.js";

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

function refuse(message: string): void {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

async function check(storage: string, team: HookTeam): Promise<void> {
  let rawInput = "";
  try {
    rawInput = await readBoundedStdin();
  } catch {
    // Empty input produces the protocol's fail-closed response.
  }
  const args = process.argv.slice(2);
  // An organization may cap Avertir; without a cap, the 8-hour ceiling alone
  // applies.
  const edition = await team.prepare(storage, args);
  const mode = effectiveMode(
    parseHookMode(args),
    readObserveDeadline(storage),
    Date.now(),
    edition.observeCap,
  );
  const results: ScanResult[] = [];
  const response = runHook(
    rawInput,
    mode,
    undefined,
    edition.rules,
    (result) => {
      results.push(result);
    },
  );
  const verdict = await edition.settle({ rawInput, mode, response, results });
  if (verdict?.effect === "refuse") {
    refuse(verdict.message);
    return;
  }
  if (verdict?.effect === "delegate") {
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
    return;
  }
  if (!response.continue) {
    refuse(
      verdict?.effect === "explain"
        ? verdict.message
        : (response.stopReason ?? "Secret Guard blocked this prompt."),
    );
    return;
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

/** One hook check: the Local edition alone unless an Équipe edition is given. */
export async function runHookCheck(
  team: HookTeam = NO_HOOK_TEAM,
): Promise<void> {
  // The installed hook lives in the extension's storage folder.
  const storage = dirname(process.argv[1] ?? "");
  const done = beginActivity(storage);
  try {
    await check(storage, team);
  } finally {
    done();
  }
}
