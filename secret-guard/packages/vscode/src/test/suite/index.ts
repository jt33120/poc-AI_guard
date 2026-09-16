import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import process from "node:process";

import Mocha from "mocha";
import * as vscode from "vscode";

function registerTests(mocha: Mocha): void {
  const extensionSuite = Mocha.Suite.create(
    mocha.suite,
    "xSOM Secret Guard extension",
  );

  extensionSuite.addTest(
    new Mocha.Test("activates and registers every public command", async () => {
      const extension = vscode.extensions.getExtension(
        "xsom.xsom-secret-guard-vscode",
      );
      assert.ok(extension, "development extension is discoverable");
      await extension.activate();

      const commands = new Set(await vscode.commands.getCommands(true));
      for (const command of [
        "secretGuard.showDashboard",
        "secretGuard.chooseMode",
        "secretGuard.connectGateway",
        "secretGuard.disconnectGateway",
        "secretGuard.scanSelection",
        "secretGuard.scanClipboard",
        "secretGuard.scanDocument",
        "secretGuard.enableHook",
        "secretGuard.finishCodexSetup",
        "secretGuard.disableHook",
        "secretGuard.copyRedacted",
      ]) {
        assert.ok(commands.has(command), `${command} is registered`);
      }
    }),
  );

  extensionSuite.addTest(
    new Mocha.Test(
      "declares a preview manifest without default telemetry",
      () => {
        const extension = vscode.extensions.getExtension(
          "xsom.xsom-secret-guard-vscode",
        );
        assert.ok(extension);
        const manifest = extension.packageJSON as {
          contributes?: {
            chatParticipants?: Array<{ id?: string }>;
            configuration?: {
              properties?: Record<string, { default?: unknown }>;
            };
          };
          engines?: { vscode?: string };
          preview?: unknown;
          telemetry?: unknown;
        };
        assert.equal(manifest.telemetry, undefined);
        assert.equal(manifest.preview, true);
        assert.equal(manifest.engines?.vscode, "^1.133.0");
        assert.equal(
          manifest.contributes?.chatParticipants?.[0]?.id,
          "xsom.secretGuard",
        );
        assert.equal(
          manifest.contributes?.configuration?.properties?.[
            "secretGuard.hook.autoEnable"
          ]?.default,
          true,
        );
      },
    ),
  );
}

export async function run(): Promise<void> {
  const mocha = new Mocha({ color: true, timeout: 20_000 });
  registerTests(mocha);

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures === 0) resolve();
      else
        reject(new Error(`${failures} VS Code extension-host test(s) failed`));
    });
  });

  const resultPath = process.env.XSOM_VSCODE_TEST_RESULT_PATH;
  assert.ok(resultPath, "supervised test result path is configured");
  await writeFile(resultPath, "passed\n", { mode: 0o600 });
}
