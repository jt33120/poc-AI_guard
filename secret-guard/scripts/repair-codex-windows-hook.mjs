// Repair the standalone Windows installation used before extension onboarding.
// Dry-run by default. This never edits Codex's trust store.
import { spawnSync } from "node:child_process";
import { constants, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  configureHost,
  defaultHostDefinitions,
  MANAGED_MARKER,
  renderPowerShellCommand,
} from "../packages/vscode/src/host-config.ts";

if (process.platform !== "win32") throw new Error("Windows only");
if (process.argv.slice(2).some((arg) => arg !== "--apply")) {
  throw new Error(
    "Usage: node scripts/repair-codex-windows-hook.mjs [--apply]",
  );
}
const host = defaultHostDefinitions().find((entry) => entry.id === "codex");
const bundle = join(
  homedir(),
  "AppData",
  "Local",
  "xsom-secret-guard",
  "hook.cjs",
);
const before = readFileSync(host.configPath, "utf8");
const entries = JSON.parse(before).hooks.UserPromptSubmit.flatMap(
  (entry) => entry.hooks,
);
const owned = entries.filter((entry) =>
  entry.command?.includes(MANAGED_MARKER),
);
const command = renderPowerShellCommand(process.execPath, bundle, "block");
if (owned.length !== 1) {
  throw new Error(
    "Refusing to change an unrecognized standalone hook installation",
  );
}
// configureHost accepts only exact current or explicitly supported legacy
// xSOM definitions and refuses any merely marker-shaped command.
const after = configureHost(before, host, process.execPath, bundle, "block");
for (const [prompt, expected] of [
  ["Bonjour", 0],
  [
    "Analyse cette configuration : PASSWORD=definitely-not-a-real-secret-123",
    2,
  ],
]) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt }),
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    },
  );
  if (
    result.error ||
    result.status !== expected ||
    (expected === 0 && JSON.parse(result.stdout).continue !== true) ||
    (expected === 2 &&
      !result.stderr.includes("Secret Guard detected password"))
  ) {
    throw new Error("Local hook verification failed; configuration unchanged");
  }
}
console.log(
  "Local command verified: clean prompt exit 0; fake password exit 2.",
);
if (after === before) {
  console.log("Configuration already repaired.");
} else if (!process.argv.includes("--apply")) {
  console.log(
    "Ready to repair only the Secret Guard entry in " + host.configPath,
  );
} else {
  if (readFileSync(host.configPath, "utf8") !== before)
    throw new Error("Configuration changed during verification");
  const backup =
    host.configPath + ".backup-before-powershell-repair-" + Date.now();
  copyFileSync(host.configPath, backup, constants.COPYFILE_EXCL);
  writeFileSync(host.configPath, after, "utf8");
  console.log("Repaired. Backup: " + backup);
  console.log(
    "Review the changed definition in Codex CLI /hooks and start a new IDE session.",
  );
}
