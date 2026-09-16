import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import process from "node:process";
import * as vscode from "vscode";
import {
  AuditQueue,
  gatewayJson,
  gatewayUrl,
  type AuditEvent,
  type QueueState,
} from "./gateway-client.js";
import { startGatewayBridge, type GatewayBridge } from "./gateway-bridge.js";
import { canDelegate, routeFile } from "./gateway-delegation.js";

interface Connection {
  endpoint: string;
  token: string;
  installation: string;
}
interface EnvEntry {
  name: string;
  value: string;
}
const SECRET = "xsom.gateway.connection";
const CONNECTION_ERRORS: Record<string, string> = {
  claude_extension_missing:
    "Installez d’abord l’extension officielle Claude Code dans cette fenêtre VS Code.",
  existing_claude_gateway:
    "Claude utilise déjà une autre passerelle. Sa configuration n’a pas été remplacée.",
  workspace_claude_override:
    "Des variables Claude sont définies au niveau du projet. Résolvez ce conflit avant de raccorder le poste.",
  gateway_owned_by_another_window:
    "Le relais xSOM est déjà actif dans une autre fenêtre VS Code. Utilisez cette fenêtre pour gérer le raccordement.",
  unsupported_gateway:
    "Cette passerelle ne confirme pas le protocole Secret Guard attendu. Le serveur doit être mis à jour.",
};

export class GatewayIntegration implements vscode.Disposable {
  private bridge: GatewayBridge | undefined;
  private queue: AuditQueue | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  public status = "Non connecté";
  public constructor(private readonly context: vscode.ExtensionContext) {}
  public get summary(): string {
    return `${this.status}${this.queue ? ` · Audit : ${this.queue.pending} en attente, ${this.queue.dropped} perdu(s) · ${this.queue.lastSync}` : ""}`;
  }
  public record(event: Omit<AuditEvent, "event_id" | "at" | "dropped">): void {
    if (this.queue) void this.queue.enqueue(event);
  }
  public async restore(): Promise<void> {
    if (vscode.env.remoteName) return;
    const stored = await this.context.secrets.get(SECRET);
    if (!stored) return;
    try {
      await this.start(JSON.parse(stored) as Connection);
    } catch {
      this.status = "Connexion indisponible · nouvelle tentative dans 30 s";
      this.retry = setTimeout(() => {
        void this.restore();
      }, 30000);
    }
  }
  public async connect(): Promise<void> {
    if (vscode.env.remoteName) {
      await vscode.window.showErrorMessage(
        "Ce premier raccordement nécessite une fenêtre VS Code locale.",
      );
      return;
    }
    const endpoint = await vscode.window.showInputBox({
      title: "xSOM · Adresse de la passerelle",
      prompt:
        "URL du service LLM xSOM, en HTTPS (ou HTTP localhost pour le développement).",
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          gatewayUrl(value);
          return undefined;
        } catch {
          return "Adresse HTTPS sans identifiant, paramètre ni fragment.";
        }
      },
    });
    if (!endpoint) return;
    const token = await vscode.window.showInputBox({
      title: "xSOM · Enregistrer ce poste",
      prompt:
        "Jeton de passerelle dédié à ce PC, créé dans la console xSOM. Conservé dans le coffre VS Code.",
      password: true,
      ignoreFocusOut: true,
    });
    if (!token) return;
    const installation =
      this.context.globalState.get<string>("xsom.installation") ?? randomUUID();
    await this.context.globalState.update("xsom.installation", installation);
    try {
      await this.start({ endpoint: gatewayUrl(endpoint), token, installation });
      await this.context.secrets.store(
        SECRET,
        JSON.stringify({ endpoint: gatewayUrl(endpoint), token, installation }),
      );
      await vscode.workspace
        .getConfiguration("secretGuard")
        .update("mode", "redact", vscode.ConfigurationTarget.Global);
      await vscode.window.showInformationMessage(
        "Poste enregistré. Claude utilisera le nettoyage xSOM dans une nouvelle session. L’authentification reste celle de Claude ; aucun appel payant de test n’a été lancé.",
      );
    } catch (error) {
      this.status = "Connexion refusée ou indisponible";
      await vscode.window.showErrorMessage(
        (error instanceof Error
          ? CONNECTION_ERRORS[error.message]
          : undefined) ??
          "Connexion xSOM impossible. Vérifiez l’adresse, le jeton dédié et la migration du serveur. Aucun jeton n’est affiché dans les journaux.",
      );
    }
  }
  private async start(connection: Connection): Promise<void> {
    const registration = (await gatewayJson(
      connection.endpoint,
      connection.token,
      "/v1/extension/register",
      {
        installation_id: connection.installation,
        platform: process.platform,
        extension_version: this.context.extension.packageJSON.version as string,
        mode: "redact",
      },
    )) as { device_id?: unknown; redaction?: unknown; protocol?: unknown };
    if (
      registration.device_id !== connection.installation ||
      registration.redaction !== "required" ||
      registration.protocol !== "anthropic-messages-v1"
    )
      throw new Error("unsupported_gateway");
    const config = vscode.workspace.getConfiguration("claudeCode");
    if (!vscode.extensions.getExtension("anthropic.claude-code"))
      throw new Error("claude_extension_missing");
    const inspected = config.inspect<EnvEntry[]>("environmentVariables");
    if (inspected?.workspaceValue || inspected?.workspaceFolderValue)
      throw new Error("workspace_claude_override");
    const entries = config.get<EnvEntry[]>("environmentVariables", []);
    const previous = this.context.globalState.get<string>("xsom.claudeBase");
    const current = entries.find(
      (entry) => entry.name === "ANTHROPIC_BASE_URL",
    )?.value;
    if (current && current !== previous)
      throw new Error("existing_claude_gateway");
    if (
      current &&
      current !== this.bridge?.baseUrl &&
      (await canDelegate(this.context.globalStorageUri.fsPath, current))
    )
      throw new Error("gateway_owned_by_another_window");
    await this.stopBridge();
    const bridge = await startGatewayBridge(
      connection.endpoint,
      connection.token,
    );
    this.bridge = bridge;
    try {
      await mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
      await writeFile(
        routeFile(this.context.globalStorageUri.fsPath, bridge.baseUrl),
        JSON.stringify({ baseUrl: bridge.baseUrl }),
        { mode: 0o600 },
      );
      await this.context.globalState.update("xsom.claudeBase", bridge.baseUrl);
      await config.update(
        "environmentVariables",
        [
          ...entries.filter((entry) => entry.name !== "ANTHROPIC_BASE_URL"),
          { name: "ANTHROPIC_BASE_URL", value: bridge.baseUrl },
        ],
        vscode.ConfigurationTarget.Global,
      );
    } catch (error) {
      await this.stopBridge();
      throw error;
    }
    const queueKey = `xsom.audit.${connection.installation}.${connection.endpoint}`;
    this.queue = new AuditQueue(
      this.context.globalState.get<QueueState>(queueKey) ?? {
        events: [],
        dropped: 0,
      },
      async (state) => {
        await this.context.globalState.update(queueKey, state);
      },
      async (events) => {
        const result = (await gatewayJson(
          connection.endpoint,
          connection.token,
          "/v1/extension/events",
          { events },
        )) as { accepted?: unknown };
        if (
          !Array.isArray(result.accepted) ||
          result.accepted.some((item) => typeof item !== "string")
        )
          throw new Error("invalid_ack");
        return result.accepted as string[];
      },
    );
    this.record({
      kind: "gateway_configured",
      assistant: "claude",
      mode: "redact",
      outcome: "configured",
      findings: 0,
    });
    this.timer = setInterval(() => {
      this.record({
        kind: "heartbeat",
        assistant: "claude",
        mode: "redact",
        outcome: "configured",
        findings: 0,
      });
      void this.queue?.flush();
    }, 30000);
    void this.queue.flush();
    this.status =
      "Claude raccordé · nettoyage obligatoire · session réelle à vérifier";
  }
  private async stopBridge(): Promise<void> {
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.bridge) {
      const old = this.bridge;
      this.bridge = undefined;
      await old.close();
      await rm(routeFile(this.context.globalStorageUri.fsPath, old.baseUrl), {
        force: true,
      });
    }
  }
  public async disconnect(): Promise<void> {
    const config = vscode.workspace.getConfiguration("claudeCode");
    const entries = config.get<EnvEntry[]>("environmentVariables", []);
    const ours = this.context.globalState.get<string>("xsom.claudeBase");
    if (
      ours &&
      entries.some(
        (entry) => entry.name === "ANTHROPIC_BASE_URL" && entry.value === ours,
      )
    ) {
      await config.update(
        "environmentVariables",
        entries.filter((entry) => entry.name !== "ANTHROPIC_BASE_URL"),
        vscode.ConfigurationTarget.Global,
      );
    }
    await this.stopBridge();
    this.queue = undefined;
    await this.context.secrets.delete(SECRET);
    await this.context.globalState.update("xsom.claudeBase", undefined);
    this.status = "Déconnecté";
  }
  public dispose(): void {
    void this.stopBridge().catch(() => undefined);
  }
}
