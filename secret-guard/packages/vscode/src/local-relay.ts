import { mkdir, rm, writeFile } from "node:fs/promises";

import * as vscode from "vscode";

import type { UnanalysedPolicy } from "@xsom/secret-guard-relay";

import { routeFile } from "./gateway-delegation.js";
import {
  startRelayThread,
  withoutRelayBase,
  withRelayBase,
  type ClaudeEnvEntry,
  type RelayThread,
} from "./relay-thread.js";

const ENABLED_KEY = "xsom.localRelay";
const BASE_KEY = "xsom.localRelay.base";
const OFFERED_KEY = "xsom.localRelay.offered";
const GATEWAY_BASE_KEY = "xsom.claudeBase";
const CLAUDE_EXTENSION = "anthropic.claude-code";

const ACTIVATE = "Activer";
const ACTIVATE_WITH_SCREENSHOTS =
  "Activer et laisser passer les captures d’écran";
const CONSENT_DETAIL =
  "Vos requêtes Claude Code passeront par un relais Secret Guard sur ce PC : les secrets détectés sont retirés avant l’envoi à Anthropic, et la session continue. Rien ne part chez xSOM.\n\nLes captures d’écran et les images ne peuvent pas être analysées. Par défaut, elles restent bloquées. Si vous les laissez passer, elles partent sans analyse, avec un message à chaque fois.\n\nOuvrez ensuite une nouvelle session Claude.";

interface Enabled {
  readonly unanalysed: UnanalysedPolicy;
}

/**
 * Secret Guard Basic's transparent purge for Claude Code: a relay on this
 * workstation, started off the extension host thread, that Claude reaches
 * through ANTHROPIC_BASE_URL. Nothing goes to xSOM.
 */
export class LocalRelay implements vscode.Disposable {
  private thread: RelayThread | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get enabled(): boolean {
    return this.state() !== undefined;
  }

  /** Restarts the relay of a previous session; its address changes each time. */
  async restore(): Promise<void> {
    const state = this.state();
    if (state === undefined) return;
    try {
      await this.start(state.unanalysed);
    } catch (error) {
      const answer = await vscode.window.showErrorMessage(
        `Secret Guard n’a pas pu démarrer la purge transparente (${reason(error)}). Les nouvelles sessions Claude n’enverront rien tant qu’elle est active.`,
        "Désactiver la purge",
      );
      if (answer === "Désactiver la purge") await this.disable();
    }
  }

  /** Offered once, when the user chooses Expurger and Claude Code is installed. */
  async offer(): Promise<void> {
    if (
      this.enabled ||
      this.context.globalState.get<boolean>(OFFERED_KEY) === true ||
      vscode.extensions.getExtension(CLAUDE_EXTENSION) === undefined ||
      this.gatewayConnected()
    )
      return;
    await this.context.globalState.update(OFFERED_KEY, true);
    await this.enable();
  }

  /** Asks for consent, then starts the relay and points Claude Code to it. */
  async enable(): Promise<void> {
    if (this.gatewayConnected()) {
      void vscode.window.showInformationMessage(
        "La passerelle xSOM est raccordée : elle nettoie déjà vos requêtes Claude.",
      );
      return;
    }
    if (vscode.extensions.getExtension(CLAUDE_EXTENSION) === undefined) {
      void vscode.window.showWarningMessage(
        "La purge transparente nécessite l’extension Claude Code.",
      );
      return;
    }
    const answer = await vscode.window.showInformationMessage(
      "Purger les secrets sans bloquer Claude Code ?",
      { modal: true, detail: CONSENT_DETAIL },
      ACTIVATE,
      ACTIVATE_WITH_SCREENSHOTS,
    );
    if (answer === undefined) return;
    const unanalysed: UnanalysedPolicy =
      answer === ACTIVATE_WITH_SCREENSHOTS ? "allow" : "refuse";
    try {
      await this.start(unanalysed);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Purge transparente non activée : ${reason(error)}.`,
      );
      return;
    }
    await this.context.globalState.update(ENABLED_KEY, { unanalysed });
    void vscode.window.showInformationMessage(
      "Purge transparente activée. Ouvrez une nouvelle session Claude pour l’utiliser.",
    );
  }

  /** Stops the relay and gives Claude Code its direct route back. */
  async disable(): Promise<void> {
    await this.stop();
    const config = vscode.workspace.getConfiguration("claudeCode");
    const entries = config.get<ClaudeEnvEntry[]>("environmentVariables", []);
    const remaining = withoutRelayBase(
      entries,
      this.context.globalState.get<string>(BASE_KEY),
    );
    if (remaining !== undefined)
      await config.update(
        "environmentVariables",
        remaining,
        vscode.ConfigurationTarget.Global,
      );
    await this.context.globalState.update(BASE_KEY, undefined);
    await this.context.globalState.update(ENABLED_KEY, undefined);
  }

  dispose(): void {
    void this.stop();
  }

  private state(): Enabled | undefined {
    const value = this.context.globalState.get<Enabled>(ENABLED_KEY);
    return value?.unanalysed === "allow" || value?.unanalysed === "refuse"
      ? value
      : undefined;
  }

  private gatewayConnected(): boolean {
    return this.context.globalState.get<string>(GATEWAY_BASE_KEY) !== undefined;
  }

  private async start(unanalysed: UnanalysedPolicy): Promise<void> {
    const config = vscode.workspace.getConfiguration("claudeCode");
    const inspected = config.inspect<ClaudeEnvEntry[]>("environmentVariables");
    if (inspected?.workspaceValue || inspected?.workspaceFolderValue)
      throw new Error("ce dossier impose ses propres variables à Claude Code");
    await this.stop();
    const thread = await startRelayThread(
      this.context.asAbsolutePath("dist/relay-worker.cjs"),
      unanalysed,
    );
    this.thread = thread;
    try {
      const entries = withRelayBase(
        config.get<ClaudeEnvEntry[]>("environmentVariables", []),
        thread.baseUrl,
        this.context.globalState.get<string>(BASE_KEY),
      );
      if (entries === "conflict")
        throw new Error("Claude Code utilise déjà une autre adresse d’envoi");
      const storage = this.context.globalStorageUri.fsPath;
      await mkdir(storage, { recursive: true });
      // The hook delegates only to a relay recorded here, and learns from it
      // whether images may go through.
      await writeFile(
        routeFile(storage, thread.baseUrl),
        JSON.stringify({ baseUrl: thread.baseUrl, unanalysed }),
        { mode: 0o600 },
      );
      await this.context.globalState.update(BASE_KEY, thread.baseUrl);
      await config.update(
        "environmentVariables",
        entries,
        vscode.ConfigurationTarget.Global,
      );
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private async stop(): Promise<void> {
    const thread = this.thread;
    if (thread === undefined) return;
    this.thread = undefined;
    await thread.stop();
    await rm(routeFile(this.context.globalStorageUri.fsPath, thread.baseUrl), {
      force: true,
    });
  }
}

function reason(error: unknown): string {
  return error instanceof Error && error.message !== "local_relay_failed"
    ? error.message
    : "le relais n’a pas démarré";
}
