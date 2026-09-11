import { access } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runTests } from "@vscode/test-electron";

const extensionDevelopmentPath = fileURLToPath(
  new URL("../packages/vscode", import.meta.url),
);
const extensionTestsPath = fileURLToPath(
  new URL("../packages/vscode/dist/test/suite/index.cjs", import.meta.url),
);
const SUCCESS_MESSAGE = "xsom-secret-guard-vscode-tests-passed";
const isolatedHome = process.env.XSOM_VSCODE_TEST_HOME;
const resultPath = process.env.XSOM_VSCODE_TEST_RESULT_PATH;

if (isolatedHome === undefined || resultPath === undefined) {
  throw new Error("VS Code test isolation paths are required");
}

async function waitForSuccessMarker() {
  for (;;) {
    try {
      await access(resultPath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function notifySuccess() {
  if (process.send === undefined)
    throw new Error("VS Code test supervisor IPC is unavailable");
  await new Promise((resolve, reject) => {
    process.send?.({ type: SUCCESS_MESSAGE }, (error) => {
      if (error === null || error === undefined) resolve();
      else reject(error);
    });
  });
}

try {
  const run = runTests({
    version: "1.137.0",
    extensionDevelopmentPath,
    extensionTestsPath,
    extensionTestsEnv: {
      ...process.env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
    },
    launchArgs: [
      `--user-data-dir=${join(isolatedHome, "user")}`,
      `--extensions-dir=${join(isolatedHome, "extensions")}`,
      "--disable-extensions",
      "--skip-welcome",
      "--skip-release-notes",
    ],
  }).then(
    () => ({ status: "exited" }),
    (error) => ({ status: "failed", error }),
  );
  const outcome = await Promise.race([
    run,
    waitForSuccessMarker().then(() => ({ status: "passed" })),
  ]);
  if (outcome.status === "failed") throw outcome.error;
  if (outcome.status === "passed") {
    await notifySuccess();
    // The parent owns teardown of this isolated process group after receiving
    // the completed-suite marker.
    await new Promise(() => {});
  }
} catch (error) {
  process.stderr.write(
    `VS Code extension-host tests failed: ${String(error)}\n`,
  );
  process.exitCode = 1;
}

process.exit(process.exitCode ?? 0);
