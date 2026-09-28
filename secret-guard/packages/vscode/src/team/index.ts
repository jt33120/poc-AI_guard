import * as vscode from "vscode";
import type { CompiledRulesPack } from "@xsom/secret-guard-core";
import { builtInAuthorityKeys } from "@xsom/developer-guard-runner";
import type { TeamFactory, TeamHost } from "../team-port.js";
import { TEAM_DASHBOARD_COMMANDS, teamDashboard } from "./dashboard.js";
import { verifiedObserveCap } from "./enrollment.js";
import { customFindingFields } from "./gateway-client.js";
import { GatewayIntegration } from "./gateway-integration.js";
import { importRulesPack, readRulesPackSnapshot } from "./rules-pack-sync.js";
import {
  refusalLabel,
  rulesPackView,
  type RulesPackView,
} from "./rules-pack-view.js";
import { RUNNER_VERSION } from "./runner-version.js";

const RULES_PACK_REQUEST_URL = `mailto:julian.talou@xsom.fr?subject=${encodeURIComponent("Secret Guard Équipe — réglage sur mesure")}`;

/** The xSOM tuning applied to local scans; the hook verifies its own copy. */
class RulesPackState {
  public pack: CompiledRulesPack | undefined;
  public view: RulesPackView = rulesPackView({
    applied: { status: "none" },
    enrolled: false,
    authorityKeys: 0,
  });

  public constructor(private readonly storage: string) {}

  /** Re-read and re-verify the stored pack; never trusts the file as is. */
  public async reload(): Promise<void> {
    try {
      const snapshot = await readRulesPackSnapshot(this.storage);
      this.pack =
        snapshot.applied.status === "applied"
          ? snapshot.applied.pack
          : undefined;
      this.view = rulesPackView(snapshot);
    } catch {
      // Never "no tuning" by default: an unexpected failure is shown and
      // reported as a refused tuning, with the built-in rules still active.
      this.pack = undefined;
      this.view = rulesPackView({
        applied: { status: "rejected", reason: "unreadable" },
        enrolled: true,
        authorityKeys: builtInAuthorityKeys().length,
      });
    }
  }
}

function gatewayCommands(
  host: TeamHost,
  gateway: GatewayIntegration,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("secretGuard.connectGateway", async () => {
      host.closeControls();
      await gateway.connect();
      await host.refresh();
    }),
    vscode.commands.registerCommand(
      "secretGuard.disconnectGateway",
      async () => {
        host.closeControls();
        const answer = await vscode.window.showWarningMessage(
          "Déconnecter xSOM retire le nettoyage transparent de Claude dans les nouvelles sessions. Les hooks locaux restent actifs.",
          { modal: true },
          "Déconnecter",
        );
        if (answer === "Déconnecter") {
          await gateway.disconnect();
          await host.refresh();
        }
      },
    ),
  ];
}

function rulesPackCommands(
  host: TeamHost,
  rules: RulesPackState,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      "secretGuard.requestRulesPack",
      async () => {
        host.closeControls();
        await vscode.env.openExternal(vscode.Uri.parse(RULES_PACK_REQUEST_URL));
      },
    ),
    // Offline import for air-gapped workstations. The file is always chosen
    // by the developer in a dialog: arguments from other extensions are
    // ignored. Same verification as a synchronisation.
    vscode.commands.registerCommand("secretGuard.importRulesPack", async () => {
      host.closeControls();
      const [target] =
        (await vscode.window.showOpenDialog({
          title: "Secret Guard · Importer un réglage xSOM",
          openLabel: "Vérifier et importer",
          canSelectMany: false,
          filters: { "Réglage xSOM": ["json"] },
        })) ?? [];
      if (target === undefined) return;
      let raw: string;
      try {
        const bytes = await vscode.workspace.fs.readFile(target);
        raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        await vscode.window.showErrorMessage(
          "Fichier illisible : aucun réglage importé. Les règles intégrées restent actives.",
        );
        return;
      }
      const result = await importRulesPack(host.storage, raw).catch(
        () => ({ outcome: "error" }) as const,
      );
      await rules.reload();
      await host.refresh();
      if (result.outcome === "applied")
        await vscode.window.showInformationMessage(
          `${rules.view.line}. Réglage vérifié hors ligne et appliqué sur ce poste.`,
        );
      else
        await vscode.window.showErrorMessage(
          `Réglage refusé : ${result.outcome === "rejected" ? refusalLabel(result.reason) : "import impossible"}. Les règles intégrées restent actives.`,
        );
    }),
    // Read-only state of the xSOM tuning (no rule content, no detected
    // value), after re-verifying the stored pack. Used by the protection
    // centre refresh and the extension-host contract.
    vscode.commands.registerCommand("secretGuard.rulesPackStatus", async () => {
      await rules.reload();
      await host.refresh();
      const { view } = rules;
      return {
        state: view.state,
        line: view.line,
        ...(view.packId === undefined ? {} : { packId: view.packId }),
        ...(view.version === undefined ? {} : { version: view.version }),
        ...(view.digest === undefined ? {} : { digest: view.digest }),
        ...(view.reason === undefined ? {} : { reason: view.reason }),
      };
    }),
  ];
}

/**
 * The Équipe edition of the extension: the xSOM tuning, the enrolled
 * workstation and its Claude relay, the managed policy and the audit.
 */
export const createTeam: TeamFactory = async (host) => {
  const rules = new RulesPackState(host.storage);
  await rules.reload();
  const gateway = new GatewayIntegration(
    host.context,
    host.hookHealth,
    {
      changed: async () => {
        await rules.reload();
        await host.refresh();
      },
      view: () => rules.view,
    },
    host.policyChanged,
  );
  const commands = [
    ...gatewayCommands(host, gateway),
    ...rulesPackCommands(host, rules),
  ];
  return {
    rules: () => rules.pack,
    record: (event, findings = []) => {
      gateway.record({ ...event, ...customFindingFields(findings) });
    },
    observeCap: () => verifiedObserveCap(host.storage, RUNNER_VERSION),
    tooltipLine: () => ({
      line: rules.view.line,
      tone: rules.view.tone,
      offerRequest: rules.view.offerRequest,
    }),
    dashboard: () =>
      teamDashboard(
        {
          state: gateway.state,
          status: gateway.status,
          ...(gateway.audit === undefined ? {} : { audit: gateway.audit }),
        },
        rules.view,
      ),
    dashboardCommands: TEAM_DASHBOARD_COMMANDS,
    restore: async () => {
      await gateway.restore();
      const health = await host.hookHealth();
      gateway.record({
        kind: "local_test",
        assistant: "manual",
        mode: host.mode(),
        outcome:
          health.reason === "local_canaries_verified" ? "passed" : "failed",
        findings: 0,
      });
      await host.refresh();
    },
    dispose: () => {
      for (const command of commands) command.dispose();
      gateway.dispose();
    },
  };
};
