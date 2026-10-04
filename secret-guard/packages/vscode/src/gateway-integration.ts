import {
  beginPairing,
  cancelPairing,
  confirmationUrl,
  pollPairing,
} from "./organization-pairing.js";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import process from "node:process";
import * as vscode from "vscode";
import { evaluatePosture } from "@xsom/developer-guard-runner";
import {
  AuditQueue,
  gatewayJson,
  gatewayUrl,
  platformCompatibleEvent,
  type AuditEvent,
  type QueueState,
} from "./gateway-client.js";
import { startGatewayBridge, type GatewayBridge } from "./gateway-bridge.js";
import { startApprovalBridge, type ApprovalBridge } from "./approval-bridge.js";
import { canDelegate, routeFile } from "./gateway-delegation.js";
import {
  readManagedPolicySummary,
  syncManagedPolicy,
  verifiedPolicyTenant,
} from "./enrollment.js";
import { readLastHookAt } from "./hook-activity.js";
import type { HookHealth } from "./hook-manager.js";
import {
  forgetEnrollment,
  syncRulesPack,
  type EnrolledTenant,
  type RulesPackSyncOutcome,
} from "./rules-pack-sync.js";
import type { RulesPackView } from "./rules-pack-view.js";

/** How the gateway reports the xSOM tuning it synchronises. */
export interface RulesPackLink {
  /** Re-read the verified pack after a sync and refresh the interface. */
  readonly changed: () => Promise<void>;
  /** The current state, for the posture event. */
  readonly view: () => RulesPackView;
}

const RULES_PACK_SYNC_MS = 60 * 60 * 1000;

function registeredTenant(value: unknown): EnrolledTenant | undefined {
  return typeof value === "string" && value.length >= 1 && value.length <= 128
    ? { id: value, source: "register" }
    : undefined;
}

function rulesPackEvent(
  outcome: RulesPackSyncOutcome,
  view: RulesPackView,
): Omit<AuditEvent, "event_id" | "at" | "dropped"> {
  return {
    kind: "rules_pack_synced",
    assistant: "secretguard",
    mode: "redact",
    outcome:
      outcome.outcome === "rejected"
        ? "failed"
        : outcome.outcome === "error"
          ? "unverified"
          : "configured",
    findings: 0,
    ...(outcome.outcome === "applied" &&
    view.packId !== undefined &&
    view.version !== undefined
      ? {
          rules_pack_id: view.packId,
          rules_pack_version: view.version,
          rules_pack_digest: outcome.digest,
        }
      : {}),
  };
}

export type GatewayState = "online" | "retrying" | "offline";

interface Connection {
  endpoint: string;
  token: string;
  installation: string;
  relay?: boolean;
  organization?: string;
}
interface EnvEntry {
  name: string;
  value: string;
}
const CONNECTION_STORAGE_KEY = "xsom.gateway.connection";
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
  private approvalBridge: ApprovalBridge | undefined;
  private queue: AuditQueue | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private rulesTimer: ReturnType<typeof setInterval> | undefined;
  // Set once the platform has answered the rules-pack route (contract §7).
  private platformServesRulesPack = false;
  private pendingRulesSync: Promise<void> = Promise.resolve();
  private retry: ReturnType<typeof setTimeout> | undefined;
  private connecting = false;
  public status = "Entreprise non reliée";
  private mode(): "block" | "redact" | "observe" {
    const mode = vscode.workspace
      .getConfiguration("secretGuard")
      .get<string>("mode", "block");
    return mode === "redact" || mode === "observe" ? mode : "block";
  }
  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly readHookHealth: () => Promise<HookHealth>,
    private readonly rules?: RulesPackLink,
    private readonly policyChanged?: () => Promise<void>,
  ) {}
  public get relayActive(): boolean {
    return this.bridge !== undefined;
  }
  public get summary(): string {
    const audit = this.audit;
    return `${this.status}${audit === undefined ? "" : ` · ${audit}`}`;
  }
  public get audit(): string | undefined {
    return this.queue
      ? `Audit : ${this.queue.pending} en attente, ${this.queue.dropped} perdu(s) · ${this.queue.lastSync}`
      : undefined;
  }
  public get state(): GatewayState {
    if (this.queue) return this.queue.lastSync === "ok" ? "online" : "retrying";
    return this.retry ? "retrying" : "offline";
  }
  public record(event: Omit<AuditEvent, "event_id" | "at" | "dropped">): void {
    if (!this.queue) return;
    const compatible = platformCompatibleEvent(
      event,
      this.platformServesRulesPack,
    );
    if (compatible !== undefined) void this.queue.enqueue(compatible);
  }
  public async restore(): Promise<void> {
    if (vscode.env.remoteName) return;
    const stored = await this.context.secrets.get(CONNECTION_STORAGE_KEY);
    if (!stored) return;
    try {
      await this.start(JSON.parse(stored) as Connection);
    } catch {
      await this.stopBridge();
      this.queue = undefined;
      this.status = "Connexion indisponible · nouvelle tentative dans 30 s";
      this.retry = setTimeout(() => {
        void this.restore();
      }, 30000);
    }
  }
  public async connectOrganization(): Promise<void> {
    if (this.connecting) return;
    if (vscode.env.remoteName) {
      await vscode.window.showErrorMessage(
        "Reliez ce poste depuis une fenêtre VS Code locale.",
      );
      return;
    }
    if (await this.context.secrets.get(CONNECTION_STORAGE_KEY)) {
      await vscode.window.showInformationMessage(
        "Ce poste est déjà relié. Son état apparaît dans le centre de protection.",
      );
      return;
    }
    const consoleUrl = await vscode.window.showInputBox({
      title: "Dev Guard · Relier à mon entreprise",
      value: "https://guard.xsom.fr",
      prompt: "Adresse de la console de votre entreprise.",
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          const url = new URL(gatewayUrl(value));
          return url.pathname === "/"
            ? undefined
            : "Indiquez l’adresse de la console sans chemin.";
        } catch {
          return "Adresse HTTPS, ou localhost pour un service local.";
        }
      },
    });
    if (!consoleUrl) return;
    this.connecting = true;
    let pending: Awaited<ReturnType<typeof beginPairing>> | undefined;
    let attached = false;
    try {
      const installation =
        this.context.globalState.get<string>("xsom.installation") ??
        randomUUID();
      await this.context.globalState.update("xsom.installation", installation);
      pending = await beginPairing(consoleUrl, {
        installation_id: installation,
        platform: process.platform,
        extension_version: this.context.extension.packageJSON.version as string,
        mode: this.mode(),
      });
      const pairing = pending;
      const opened = await vscode.env.openExternal(
        vscode.Uri.parse(confirmationUrl(pairing)),
      );
      if (!opened) throw new Error("browser_unavailable");
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Dev Guard · Confirmez ${pairing.code} dans la console`,
          cancellable: true,
        },
        async (progress, cancellation) => {
          while (
            !cancellation.isCancellationRequested &&
            Date.now() < pairing.expiresAt
          ) {
            const organization = await pollPairing(pairing);
            if (organization !== undefined) {
              const connection: Connection = {
                endpoint: pairing.endpoint,
                token: pairing.credential,
                installation,
                relay: false,
                organization,
              };
              await this.context.secrets.store(
                CONNECTION_STORAGE_KEY,
                JSON.stringify(connection),
              );
              attached = true;
              await this.start(connection);
              await vscode.window.showInformationMessage(
                `Poste relié à ${organization}. Le suivi est actif ; le relais Claude reste désactivé.`,
              );
              return;
            }
            progress.report({
              message: "En attente de votre confirmation dans le navigateur…",
            });
            await new Promise<void>((resolve) => {
              const timer = setTimeout(() => {
                disposable.dispose();
                resolve();
              }, 5000);
              const disposable = cancellation.onCancellationRequested(() => {
                clearTimeout(timer);
                disposable.dispose();
                resolve();
              });
            });
          }
          if (!cancellation.isCancellationRequested)
            throw new Error("pairing_expired");
        },
      );
    } catch {
      this.status = attached
        ? "Entreprise reliée · connexion à rétablir"
        : "Rattachement non terminé";
      if (attached) {
        this.retry = setTimeout(() => {
          void this.restore();
        }, 30000);
      }
      await vscode.window.showErrorMessage(
        attached
          ? "Le poste est enregistré. La connexion sera réessayée automatiquement."
          : "Rattachement non terminé : vérifiez le service, vos droits d’administration et la validité du code, puis réessayez.",
      );
    } finally {
      if (pending && !attached)
        await cancelPairing(pending).catch(() => undefined);
      this.connecting = false;
    }
  }
  public async connect(): Promise<void> {
    const saved = await this.context.secrets.get(CONNECTION_STORAGE_KEY);
    if (saved) {
      const connection = JSON.parse(saved) as Connection;
      const answer = await vscode.window.showWarningMessage(
        "Activer le relais Claude transmet les prompts des nouvelles sessions à votre passerelle pour nettoyage.",
        { modal: true },
        "Activer le relais Claude",
      );
      if (answer !== "Activer le relais Claude") return;
      const updated = { ...connection, relay: true };
      try {
        await this.start(updated);
        await this.context.secrets.store(
          CONNECTION_STORAGE_KEY,
          JSON.stringify(updated),
        );
      } catch {
        await this.stopBridge();
        await this.start(connection).catch(() => {
          this.status = "Entreprise reliée · connexion à rétablir";
        });
        await vscode.window.showErrorMessage(
          "Relais Claude indisponible. Vérifiez sa configuration ; le rattachement à l’entreprise est conservé.",
        );
      }
      return;
    }

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
        CONNECTION_STORAGE_KEY,
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
  /** Fetch and verify the xSOM tuning, then let the interface re-read it. */
  private syncRules(
    connection: Connection,
    enrolledTenant: EnrolledTenant | undefined,
  ): Promise<RulesPackSyncOutcome> {
    // One synchronisation at a time; a disconnection waits for it before
    // forgetting the enrollment, so a late sync cannot re-apply a pack.
    const run = this.pendingRulesSync.then(async () => {
      const outcome = await syncRulesPack(
        connection.endpoint,
        connection.token,
        this.context.globalStorageUri.fsPath,
        enrolledTenant === undefined ? {} : { enrolledTenant },
      ).catch((): RulesPackSyncOutcome => ({ outcome: "error" }));
      // Any answer of the route, even "no tuning", shows the platform speaks
      // contract §7; a network error leaves what was known.
      if (outcome.outcome !== "error") this.platformServesRulesPack = true;
      await this.rules?.changed().catch(() => undefined);
      return outcome;
    });
    this.pendingRulesSync = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
        mode: this.mode(),
      },
    )) as {
      device_id?: unknown;
      redaction?: unknown;
      protocol?: unknown;
      tenant_id?: unknown;
    };
    if (
      registration.device_id !== connection.installation ||
      registration.redaction !== "required" ||
      registration.protocol !== "anthropic-messages-v1"
    )
      throw new Error("unsupported_gateway");
    const runnerVersion = this.context.extension.packageJSON.version as string;
    const policyState = await syncManagedPolicy(
      connection.endpoint,
      connection.token,
      this.context.globalStorageUri.fsPath,
      runnerVersion,
    );
    await this.policyChanged?.().catch(() => undefined);
    // The enrolled tenant, as stated by the platform: at registration when it
    // says so, else in the signed policy; otherwise the first pack pins it.
    const policyTenant = await verifiedPolicyTenant(
      this.context.globalStorageUri.fsPath,
    );
    const enrolledTenant =
      registeredTenant(registration.tenant_id) ??
      (policyTenant === undefined
        ? undefined
        : { id: policyTenant, source: "policy" as const });
    const rulesOutcome = await this.syncRules(connection, enrolledTenant);
    await this.stopBridge();
    this.queue = undefined;
    if (connection.relay !== false) await this.startRelay(connection);
    try {
      this.approvalBridge = await startApprovalBridge(
        this.context.globalStorageUri.fsPath,
        connection.endpoint,
        connection.token,
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
    if (connection.relay !== false)
      this.record({
        kind: "gateway_configured",
        assistant: "claude",
        mode: "redact",
        outcome: "configured",
        findings: 0,
      });
    this.record({
      kind: "policy_synced",
      assistant: "secretguard",
      mode: this.mode(),
      outcome: policyState === "assigned" ? "configured" : "unverified",
      findings: 0,
    });
    this.record({
      kind: "policy_synced",
      assistant: "secretguard",
      mode: "redact",
      outcome: policyState === "assigned" ? "configured" : "unverified",
      findings: 0,
    });
    if (this.rules !== undefined)
      this.record(rulesPackEvent(rulesOutcome, this.rules.view()));
    const emitPosture = async (): Promise<void> => {
      const [hookHealth, policy] = await Promise.all([
        this.readHookHealth(),
        readManagedPolicySummary(this.context.globalStorageUri.fsPath),
      ]);
      const lastHookAt = readLastHookAt(this.context.globalStorageUri.fsPath);
      const result = evaluatePosture({
        policyPresent: policyState === "assigned" && policy !== undefined,
        ...(policy === undefined ? {} : { policyExpiresAt: policy.expiresAt }),
        hookInstalled:
          hookHealth.state === "active" || hookHealth.state === "partial",
        ...(lastHookAt === undefined
          ? {}
          : { lastHookInvocationAt: new Date(lastHookAt).toISOString() }),
        queuePending: this.queue?.pending ?? 0,
        queueDropped: this.queue?.dropped ?? 0,
      });
      const specificReason =
        hookHealth.reason === "config_invalid" ||
        hookHealth.reason === "hook_modified" ||
        hookHealth.reason === "canary_failed"
          ? hookHealth.reason
          : undefined;
      const rules = this.rules?.view();
      const reasons: AuditEvent["posture_reasons"] = [
        ...new Set([
          ...result.reasons,
          ...(specificReason === undefined ? [] : [specificReason]),
          ...(rules?.reason === undefined ? [] : [rules.reason]),
        ]),
      ];
      this.record({
        kind: "posture",
        assistant: "secretguard",
        mode: this.mode(),
        outcome:
          result.state === "healthy" && rules?.reason === undefined
            ? "configured"
            : "unverified",
        findings: 0,
        posture_reasons: reasons,
        ...(policy === undefined
          ? {}
          : { policy_id: policy.policyId, policy_version: policy.version }),
        ...(rules?.packId === undefined ||
        rules.version === undefined ||
        rules.digest === undefined
          ? {}
          : {
              rules_pack_id: rules.packId,
              rules_pack_version: rules.version,
              rules_pack_digest: rules.digest,
            }),
        runner_version: runnerVersion,
        queue_pending: this.queue?.pending ?? 0,
      });
    };
    await emitPosture();
    this.timer = setInterval(() => {
      void emitPosture().catch(() => {
        this.status =
          "Posture indisponible · nouvelle tentative au prochain contact";
      });
      this.record({
        kind: "heartbeat",
        assistant: "secretguard",
        mode: this.mode(),
        outcome: "configured",
        findings: 0,
      });
      void this.queue?.flush();
    }, 30000);
    this.rulesTimer = setInterval(() => {
      void this.syncRules(connection, enrolledTenant)
        .then((outcome) => {
          if (this.rules !== undefined)
            this.record(rulesPackEvent(outcome, this.rules.view()));
        })
        .catch(() => undefined);
    }, RULES_PACK_SYNC_MS);
    void this.queue.flush();
    this.status =
      connection.relay === false
        ? `${connection.organization ?? "Entreprise"} · poste relié · relais Claude désactivé`
        : "Claude raccordé · nettoyage obligatoire · session réelle à vérifier";
  }
  private async startRelay(connection: Connection): Promise<void> {
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
  }
  private async stopBridge(): Promise<void> {
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    if (this.approvalBridge) {
      const bridge = this.approvalBridge;
      this.approvalBridge = undefined;
      await bridge.close();
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.rulesTimer) clearInterval(this.rulesTimer);
    this.rulesTimer = undefined;
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
    const saved = await this.context.secrets.get(CONNECTION_STORAGE_KEY);
    if (saved) {
      const connection = JSON.parse(saved) as Connection;
      try {
        await gatewayJson(
          connection.endpoint,
          connection.token,
          "/v1/extension/disconnect",
          {},
        );
      } catch (error) {
        // A credential already revoked by an admin needs only local cleanup.
        if (!(error instanceof Error) || error.message !== "gateway_http_401") {
          await vscode.window.showErrorMessage(
            "Déconnexion non confirmée par le serveur. Réessayez dès que la connexion est rétablie ; le rattachement est conservé.",
          );
          return;
        }
      }
    }
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
    if (this.approvalBridge) {
      const old = this.approvalBridge;
      this.approvalBridge = undefined;
      await old.close();
    }
    await this.stopBridge();
    this.queue = undefined;
    // Leaving xSOM ends the tuning of this workstation: built-in rules only.
    await this.pendingRulesSync;
    await forgetEnrollment(this.context.globalStorageUri.fsPath).catch(
      () => undefined,
    );
    await this.rules?.changed().catch(() => undefined);
    await this.context.secrets.delete(CONNECTION_STORAGE_KEY);
    await this.context.globalState.update("xsom.claudeBase", undefined);
    this.status = "Déconnecté";
  }
  public dispose(): void {
    void this.stopBridge().catch(() => undefined);
  }
}
