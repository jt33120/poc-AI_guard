import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const worker = fileURLToPath(
  new URL("./run-vscode-tests-worker.mjs", import.meta.url),
);
const TIMEOUT_MS = 120_000;
const SUCCESS_MESSAGE = "xsom-secret-guard-vscode-tests-passed";

function terminateTree(child) {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code === "ESRCH") return;
    // A sandboxed Electron descendant can make a process-group signal report
    // EPERM on macOS. The worker itself is always our child, so terminate it as
    // a final bounded fallback and let the watchdog report the failed run.
    try {
      child.kill("SIGKILL");
    } catch (fallbackError) {
      if (fallbackError?.code !== "ESRCH") {
        process.stderr.write(
          `Unable to terminate VS Code test worker: ${String(fallbackError)}\n`,
        );
      }
    }
  }
}

const isolatedHome = await mkdtemp(join(tmpdir(), "sg-vsc-"));
const child = spawn(process.execPath, [worker], {
  detached: process.platform !== "win32",
  env: {
    ...process.env,
    XSOM_VSCODE_TEST_HOME: isolatedHome,
    XSOM_VSCODE_TEST_RESULT_PATH: join(isolatedHome, "tests-passed"),
  },
  stdio: ["ignore", "inherit", "inherit", "ipc"],
  windowsHide: true,
});

let timedOut = false;
let extensionTestsPassed = false;
const timer = setTimeout(() => {
  timedOut = true;
  terminateTree(child);
}, TIMEOUT_MS);

child.on("message", (message) => {
  if (
    typeof message === "object" &&
    message !== null &&
    message.type === SUCCESS_MESSAGE
  ) {
    extensionTestsPassed = true;
    // VS Code 1.137 can leave its Agent Host alive after the extension-test
    // host has reported success. The marker comes from the completed Mocha
    // suite, so terminate the isolated process group instead of hanging CI.
    terminateTree(child);
  }
});

const result = await new Promise((resolve) => {
  child.once("error", (error) => resolve({ code: null, error }));
  child.once("close", (code, signal) => resolve({ code, signal }));
});
clearTimeout(timer);
await rm(isolatedHome, { recursive: true, force: true });

if (timedOut) {
  process.stderr.write("VS Code extension-host tests exceeded 120 seconds.\n");
  process.exitCode = 1;
} else if ("error" in result) {
  process.stderr.write(
    `VS Code extension-host runner failed: ${String(result.error)}\n`,
  );
  process.exitCode = 1;
} else if (!extensionTestsPassed && result.code !== 0) {
  process.stderr.write(
    `VS Code extension-host tests exited with ${String(result.code ?? result.signal)}.\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("VS Code extension-host contracts: OK\n");
}
