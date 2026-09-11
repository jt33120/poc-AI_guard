import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
  new URL("../packages/cli/dist/index.js", import.meta.url),
);
const bundledHook = fileURLToPath(
  new URL("../packages/vscode/dist/hook.cjs", import.meta.url),
);
const fakeToken = `ghp_${"aB3d".repeat(9)}`;

function run(args, input) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 3 * 1024 * 1024,
    timeout: 5_000,
  });
}

function runBundledHook(args, input) {
  return spawnSync(process.execPath, [bundledHook, ...args], {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    input,
    maxBuffer: 3 * 1024 * 1024,
    timeout: 5_000,
  });
}

const clean = run(["scan", "--json", "-"], "Explain this function");
if (clean.status !== 0 || JSON.parse(clean.stdout).decision !== "ALLOW") {
  throw new Error(`clean CLI scan failed: ${clean.stderr}`);
}

const blocked = run(["scan", "--json", "-"], `token=${fakeToken}`);
if (blocked.status !== 2 || JSON.parse(blocked.stdout).decision !== "BLOCK") {
  throw new Error(`blocking CLI scan failed: ${blocked.stderr}`);
}
if (`${blocked.stdout}${blocked.stderr}`.includes(fakeToken)) {
  throw new Error("CLI leaked the detected value");
}

const hook = run(
  ["hook"],
  JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    prompt: `token=${fakeToken}`,
  }),
);
if (
  hook.status !== 2 ||
  hook.stdout !== "" ||
  !hook.stderr.includes("Secret Guard detected")
) {
  throw new Error(`hook contract failed: ${hook.stderr}`);
}
if (`${hook.stdout}${hook.stderr}`.includes(fakeToken)) {
  throw new Error("hook leaked the detected value");
}

const cleanHook = run(
  ["hook"],
  JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    prompt: "explain this function",
  }),
);
if (
  cleanHook.status !== 0 ||
  cleanHook.stderr !== "" ||
  JSON.parse(cleanHook.stdout).continue !== true
) {
  throw new Error("clean hook contract failed");
}

const warning = "opaque Zx9Qw3Vb7Kp2Lm8Nr4Ts6Uy1Wd5Ef0Gh";
const blockedWarning = run(
  ["hook"],
  JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: warning }),
);
const allowedWarning = run(
  ["hook", "--warn=allow"],
  JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: warning }),
);
if (blockedWarning.status !== 2 || allowedWarning.status !== 0) {
  throw new Error("hook WARN policy contract failed");
}
if (
  `${blockedWarning.stdout}${blockedWarning.stderr}${allowedWarning.stdout}`.includes(
    warning,
  )
) {
  throw new Error("hook WARN response leaked its input");
}

const malformedHook = run(["hook"], "{");
if (malformedHook.status !== 2 || malformedHook.stdout !== "") {
  throw new Error("malformed hook input did not fail closed");
}

for (const execute of [
  (input) => run(["hook"], input),
  (input) => runBundledHook([], input),
]) {
  const cleanContract = execute(
    JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      prompt: "explain this function",
    }),
  );
  const blockContract = execute(
    JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      prompt: `token=${fakeToken}`,
    }),
  );
  const warnContract = execute(
    JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: warning }),
  );
  const invalidContract = execute("{");
  if (
    cleanContract.status !== 0 ||
    JSON.parse(cleanContract.stdout).continue !== true ||
    blockContract.status !== 2 ||
    blockContract.stdout !== "" ||
    warnContract.status !== 2 ||
    invalidContract.status !== 2 ||
    invalidContract.stdout !== ""
  ) {
    throw new Error("delivered hook bundle contract matrix failed");
  }
  if (
    `${blockContract.stdout}${blockContract.stderr}${warnContract.stdout}${warnContract.stderr}`.includes(
      fakeToken,
    )
  ) {
    throw new Error("delivered hook bundle leaked the detected value");
  }
}

const secretCommand = `ghp_${"Z9yX".repeat(9)}`;
const unknownCommand = run([secretCommand], "");
if (
  unknownCommand.status !== 64 ||
  `${unknownCommand.stdout}${unknownCommand.stderr}`.includes(secretCommand)
) {
  throw new Error("usage error disclosed an arbitrary command argument");
}

const ambiguousOptions = run(["scan", "--json", "--redact", "-"], fakeToken);
if (ambiguousOptions.status !== 64 || ambiguousOptions.stdout !== "") {
  throw new Error("ambiguous scan options were not rejected");
}

const temporary = await mkdtemp(join(tmpdir(), "secret-guard-cli-"));
try {
  const envPath = join(temporary, "fixture.env");
  const markdownPath = join(temporary, "fixture.md");
  const oversizedPath = join(temporary, "oversized.txt");
  await writeFile(envPath, `TOKEN=${fakeToken}`, { mode: 0o600 });
  await writeFile(markdownPath, "# Safe documentation\n", { mode: 0o600 });
  await writeFile(oversizedPath, "x".repeat(1_048_577), { mode: 0o600 });

  const envScan = run(["scan", "--json", envPath]);
  const markdownScan = run(["scan", "--json", markdownPath]);
  const oversizedScan = run(["scan", "--json", oversizedPath]);
  if (
    envScan.status !== 2 ||
    JSON.parse(envScan.stdout).decision !== "BLOCK" ||
    markdownScan.status !== 0 ||
    oversizedScan.status !== 2 ||
    JSON.parse(oversizedScan.stdout).complete !== false
  ) {
    throw new Error("bounded file scan matrix failed");
  }
  if (`${envScan.stdout}${envScan.stderr}`.includes(fakeToken)) {
    throw new Error("file scan leaked the detected value");
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write("CLI and hook subprocess contracts: OK\n");
