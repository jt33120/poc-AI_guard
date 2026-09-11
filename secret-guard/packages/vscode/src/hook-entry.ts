import process from "node:process";

import { runHook, type WarnMode } from "@xsom/secret-guard-cli/hook";

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

function configuredWarnMode(): WarnMode {
  const argument = process.argv.find((value) => value.startsWith("--warn="));
  return argument === "--warn=allow" ? "allow" : "block";
}

async function main(): Promise<void> {
  let rawInput = "";
  try {
    rawInput = await readBoundedStdin();
  } catch {
    // Empty input produces the protocol's fail-closed response.
  }
  const response = runHook(rawInput, configuredWarnMode());
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
