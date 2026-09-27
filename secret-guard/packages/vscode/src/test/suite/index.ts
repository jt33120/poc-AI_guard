import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import Mocha from "mocha";
import * as vscode from "vscode";
import { canonicalizePolicyPayload } from "@xsom/developer-guard-runner";

async function eventually(
  condition: () => boolean | Promise<boolean>,
  failure: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(failure);
}

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
        "secretGuard.purgeClipboard",
        "secretGuard.checkClipboard",
        "secretGuard.scanDocument",
        "secretGuard.enableHook",
        "secretGuard.finishCodexSetup",
        "secretGuard.disableHook",
        "secretGuard.copyRedacted",
        "secretGuard.requestRulesPack",
        "secretGuard.importRulesPack",
        "secretGuard.rulesPackStatus",
        "secretGuard.setObserveDuration",
        "secretGuard.observePolicyStatus",
      ]) {
        assert.ok(commands.has(command), `${command} is registered`);
      }
    }),
  );

  extensionSuite.addTest(
    new Mocha.Test(
      "switches mode from the status bar and ignores invalid modes",
      async () => {
        const config = (): vscode.WorkspaceConfiguration =>
          vscode.workspace.getConfiguration("secretGuard");
        await config().update(
          "mode",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
        await vscode.commands.executeCommand("secretGuard.setMode", "typo");
        assert.equal(config().inspect("mode")?.globalValue, undefined);
        // Avertir asks for a modal confirmation, so Expurger stands in here.
        await vscode.commands.executeCommand("secretGuard.setMode", "redact");
        assert.equal(config().inspect("mode")?.globalValue, "redact");
        await config().update(
          "mode",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
      },
    ),
  );

  extensionSuite.addTest(
    new Mocha.Test(
      "changes the Avertir length from the panel, never beyond eight hours",
      async () => {
        const home = process.env.XSOM_VSCODE_TEST_HOME;
        assert.ok(home, "isolated test home is configured");
        const deadlineFile = join(
          home,
          "user",
          "User",
          "globalStorage",
          "xsom.xsom-secret-guard-vscode",
          "observe-until",
        );
        const config = (): vscode.WorkspaceConfiguration =>
          vscode.workspace.getConfiguration("secretGuard");
        const remainingMinutes = async (
          accept: (minutes: number) => boolean,
        ): Promise<number> => {
          // The window is written by the configuration listener, after the
          // command or update returns: wait for the expected length.
          for (let attempt = 0; attempt < 50; attempt += 1) {
            try {
              const deadline = Number(
                (await readFile(deadlineFile, "utf8")).trim(),
              );
              const minutes = (deadline - Date.now()) / 60_000;
              if (accept(minutes)) return minutes;
            } catch {
              // Not written yet.
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error(
            "the Avertir window never reached the expected length",
          );
        };
        const near = (target: number) => (minutes: number) =>
          minutes > target - 1 && minutes <= target;

        // Avertir asks for its length in a modal; the setting stands in here.
        await config().update(
          "mode",
          "observe",
          vscode.ConfigurationTarget.Global,
        );
        await remainingMinutes(near(60));
        await vscode.commands.executeCommand(
          "secretGuard.setObserveDuration",
          15,
        );
        await remainingMinutes(near(15));
        await vscode.commands.executeCommand(
          "secretGuard.setObserveDuration",
          240,
        );
        await remainingMinutes(near(240));
        // A night's work.
        await vscode.commands.executeCommand(
          "secretGuard.setObserveDuration",
          480,
        );
        await remainingMinutes(near(480));
        // Not one of the panel's choices: nothing changes.
        await vscode.commands.executeCommand(
          "secretGuard.setObserveDuration",
          1440,
        );
        await vscode.commands.executeCommand(
          "secretGuard.setObserveDuration",
          "60",
        );
        await remainingMinutes(near(480));

        await config().update(
          "mode",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
        for (let attempt = 0; attempt < 50; attempt += 1) {
          try {
            await readFile(deadlineFile, "utf8");
          } catch {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error("leaving Avertir must close its window");
      },
    ),
  );

  extensionSuite.addTest(
    new Mocha.Test(
      "caps Avertir from the verified organization policy, and forbids it at zero",
      async () => {
        const home = process.env.XSOM_VSCODE_TEST_HOME;
        assert.ok(home, "isolated test home is configured");
        const storage = join(
          home,
          "user",
          "User",
          "globalStorage",
          "xsom.xsom-secret-guard-vscode",
        );
        const deadlineFile = join(storage, "observe-until");
        const config = (): vscode.WorkspaceConfiguration =>
          vscode.workspace.getConfiguration("secretGuard");
        const mode = (): unknown => config().inspect("mode")?.globalValue;
        type CapStatus = { cap: number | null; durations: number[] };
        const status = async (): Promise<CapStatus> =>
          (await vscode.commands.executeCommand(
            "secretGuard.observePolicyStatus",
          )) as CapStatus;
        const remainingNear = async (target: number): Promise<void> => {
          await eventually(
            async () => {
              try {
                const deadline = Number(
                  (await readFile(deadlineFile, "utf8")).trim(),
                );
                const minutes = (deadline - Date.now()) / 60_000;
                return minutes > target - 1 && minutes <= target;
              } catch {
                return false;
              }
            },
            `the Avertir window never reached ${String(target)} minutes`,
          );
        };
        const windowClosed = async (): Promise<boolean> => {
          try {
            await readFile(deadlineFile, "utf8");
            return false;
          } catch {
            return true;
          }
        };
        // A policy signed as the platform signs it, under a key pinned as an
        // enrollment pins it. Test key only; never part of a build.
        const keys = generateKeyPairSync("ed25519");
        const pinned = Buffer.from(
          (keys.publicKey.export({ format: "jwk" }) as { x: string }).x,
          "base64url",
        ).toString("base64");
        const store = async (
          version: number,
          observeMaxMinutes: number,
          storedCap = observeMaxMinutes,
        ): Promise<void> => {
          const policy = {
            schemaVersion: 1,
            tenantId: "00000000-0000-4000-8000-000000000001",
            policyId: "equipe",
            version,
            issuedAt: "2026-09-01T00:00:00Z",
            expiresAt: "2099-01-01T00:00:00Z",
            minRunnerVersion: "0.7.1",
            defaults: { unknownAction: "allow" },
            rules: [],
            workstation: { observeMaxMinutes },
          };
          const signature = sign(
            null,
            Buffer.from(canonicalizePolicyPayload(policy)),
            keys.privateKey,
          ).toString("base64");
          await mkdir(storage, { recursive: true });
          await writeFile(join(storage, "developer-policy.pub"), `${pinned}\n`);
          await writeFile(
            join(storage, "developer-policy.json"),
            JSON.stringify({
              policy: {
                ...policy,
                workstation: { observeMaxMinutes: storedCap },
              },
              signature,
              publicKey: pinned,
              keyId: "test",
            }),
          );
        };

        try {
          assert.deepEqual(await status(), {
            cap: null,
            durations: [15, 60, 240, 480],
            mode: mode() ?? "block",
          });
          // A night's work in Avertir, before the organization caps it.
          await config().update(
            "mode",
            "observe",
            vscode.ConfigurationTarget.Global,
          );
          await eventually(
            async () => !(await windowClosed()),
            "Avertir must open a window",
          );
          await vscode.commands.executeCommand(
            "secretGuard.setObserveDuration",
            480,
          );
          await remainingNear(480);

          // A one-hour cap arrives: the running window ends within the hour.
          await store(1, 60);
          const capped = await status();
          assert.equal(capped.cap, 60);
          assert.deepEqual(capped.durations, [15, 60]);
          assert.equal(mode(), "observe");
          await remainingNear(60);
          // Longer than the cap: refused, the window keeps its end.
          await vscode.commands.executeCommand(
            "secretGuard.setObserveDuration",
            240,
          );
          await remainingNear(60);
          await vscode.commands.executeCommand(
            "secretGuard.setObserveDuration",
            15,
          );
          await remainingNear(15);

          // A cap loosened by hand fails the signature: nothing is read.
          await store(2, 60, 480);
          assert.equal((await status()).cap, null);

          // Forbidden: back to Expurger at once, the window closed.
          await store(3, 0);
          assert.deepEqual((await status()).durations, []);
          await eventually(
            () => mode() === "redact",
            "a forbidding policy must end Avertir",
          );
          await eventually(windowClosed, "the Avertir window must close");
          // Not from the panel, not from a length, not by hand.
          await vscode.commands.executeCommand(
            "secretGuard.setMode",
            "observe",
          );
          assert.equal(mode(), "redact");
          await vscode.commands.executeCommand(
            "secretGuard.setObserveDuration",
            15,
          );
          assert.equal(mode(), "redact");
          await config().update(
            "mode",
            "observe",
            vscode.ConfigurationTarget.Global,
          );
          await eventually(
            () => mode() === "redact",
            "Avertir set by hand must be refused",
          );
          assert.ok(await windowClosed());
        } finally {
          await rm(join(storage, "developer-policy.json"), { force: true });
          await rm(join(storage, "developer-policy.pub"), { force: true });
          assert.equal((await status()).cap, null);
          await config().update(
            "mode",
            undefined,
            vscode.ConfigurationTarget.Global,
          );
          await eventually(windowClosed, "leaving Avertir must close it");
        }
      },
    ),
  );

  extensionSuite.addTest(
    new Mocha.Test(
      "purges the clipboard in place and leaves a clean one untouched",
      async () => {
        // Assembled at run time so the dogfood scan of this file stays clean.
        const canary = ["ghp", "aB3d".repeat(9)].join("_");
        await vscode.env.clipboard.writeText(`deploy with ${canary}`);
        await vscode.commands.executeCommand("secretGuard.purgeClipboard");
        const purged = await vscode.env.clipboard.readText();
        assert.ok(purged.startsWith("deploy with "), "context is kept");
        assert.ok(!purged.includes(canary), "the secret is gone");

        await vscode.env.clipboard.writeText("explain this function");
        await vscode.commands.executeCommand("secretGuard.purgeClipboard");
        assert.equal(
          await vscode.env.clipboard.readText(),
          "explain this function",
        );

        // A check reports the secret but never rewrites the clipboard.
        await vscode.env.clipboard.writeText(`deploy with ${canary}`);
        await vscode.commands.executeCommand("secretGuard.checkClipboard");
        assert.equal(
          await vscode.env.clipboard.readText(),
          `deploy with ${canary}`,
        );
      },
    ),
  );

  extensionSuite.addTest(
    new Mocha.Test(
      "applies a verified xSOM tuning to its own scans and shows it",
      async () => {
        const extension = vscode.extensions.getExtension(
          "xsom.xsom-secret-guard-vscode",
        );
        assert.ok(extension);
        const home = process.env.XSOM_VSCODE_TEST_HOME;
        assert.ok(home, "isolated test home is configured");
        const storage = join(
          home,
          "user",
          "User",
          "globalStorage",
          "xsom.xsom-secret-guard-vscode",
        );
        type Status = { state: string; line: string; packId?: string };
        const status = async (): Promise<Status> =>
          (await vscode.commands.executeCommand(
            "secretGuard.rulesPackStatus",
          )) as Status;

        assert.deepEqual(await status(), {
          state: "none",
          line: "Aucun réglage sur mesure",
        });

        // The contract's signed reference pack, trusted by this TEST build
        // only, stored as a synchronisation would store it.
        const vectors = JSON.parse(
          await readFile(
            join(
              extension.extensionPath,
              "..",
              "..",
              "contracts",
              "fixtures",
              "rules-pack-vectors.json",
            ),
            "utf8",
          ),
        ) as { signature: { envelope: unknown } };
        await mkdir(storage, { recursive: true });
        await writeFile(
          join(storage, "rules-pack.json"),
          JSON.stringify(vectors.signature.envelope),
        );
        await writeFile(
          join(storage, "rules-pack-state.json"),
          JSON.stringify({
            schemaVersion: 1,
            tenantId: "00000000-0000-4000-8000-000000000001",
            tenantSource: "register",
            highest: {},
          }),
        );
        try {
          const active = await status();
          assert.equal(active.state, "active");
          assert.equal(active.packId, "acme-main");
          assert.match(active.line, /^Réglage xSOM · v3 · 3 règles · /u);

          // Expurger masks the custom finding with the detector label.
          const customer = ["CLI", "00421337"].join("-");
          await vscode.env.clipboard.writeText(`Le client ${customer}.`);
          await vscode.commands.executeCommand("secretGuard.purgeClipboard");
          assert.equal(
            await vscode.env.clipboard.readText(),
            "Le client <REDACTED_Identifiant_client_ACME>.",
          );

          // A pack edited on disk is refused; built-in rules stay.
          await writeFile(
            join(storage, "rules-pack.json"),
            JSON.stringify({
              ...(vectors.signature.envelope as object),
              signature: "A".repeat(86) + "==",
            }),
          );
          const refused = await status();
          assert.equal(refused.state, "rejected");
          assert.equal(refused.line, "Réglage refusé : signature invalide");
        } finally {
          await rm(join(storage, "rules-pack.json"), { force: true });
          await rm(join(storage, "rules-pack-state.json"), { force: true });
        }
        assert.equal((await status()).state, "none");
      },
    ),
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
