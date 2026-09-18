import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { ProtectionMode } from "@xsom/secret-guard-cli/hook";

import {
  decodeScannableText,
  redactAndRescan,
  scan,
  MAX_INPUT_BYTES,
  type ScanInput,
} from "@xsom/secret-guard-core";

import {
  composePrompt,
  unreadableReferencesMessage,
  type ReferenceText,
  type ResolvedReference,
} from "./chat-references.js";

import {
  dispatchGuarded,
  type DispatchOutcome,
  type WarnChoice,
} from "./dispatch.js";
import { ActivityMonitor } from "./hook-activity.js";
import { HookManager, type HookHealth } from "./hook-manager.js";
import { GatewayIntegration } from "./gateway-integration.js";
import { activationStrategy, supportsVsCodePromptHooks } from "./onboarding.js";
import { defaultHostDefinitions } from "./host-config.js";
import { markdownReport, modalReport } from "./presentation.js";
import {
  dashboardHtml,
  DASHBOARD_COMMANDS,
  HEALTH_LABELS,
} from "./dashboard.js";
import {
  isProtectionMode,
  modeLabel,
  modeShortLabel,
  protectionMode,
  PROTECTION_MODES,
} from "./protection-mode.js";
import {
  CHECK_CLIPBOARD_COMMAND,
  PURGE_CLIPBOARD_COMMAND,
  statusBarClickCommand,
  statusTooltipMarkdown,
  STATUS_TOOLTIP_COMMANDS,
  type Appearance,
  type LastScan,
} from "./status-tooltip.js";
import {
  checkFeedback,
  CHECK_UNAVAILABLE,
  purgeClipboardText,
  purgeFeedback,
  PURGE_UNAVAILABLE,
  type PurgeFeedback,
  type PurgeOutcome,
} from "./clipboard-purge.js";
import {
  closeObserveWindow,
  observeWindowOpen,
  openObserveWindow,
  readObserveDeadline,
} from "./observe-window.js";

const FINISH_CODEX_SETUP = "Finaliser Codex";
const OBSERVE_CONFIRMATION = "Activer pour 1 heure";
const PURGE_ACTION = "Expurger";
let gateway: GatewayIntegration | undefined;
// Metadata only: the scanned content and detected values are never retained.
let lastScan: LastScan | undefined;
// End of the running Avertir window, mirrored from the file the hook reads.
let observeDeadline: number | undefined;

function clockTime(epoch: number): string {
  return new Date(epoch).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function observeUntil(): string | undefined {
  return configuredMode() === "observe" && observeDeadline !== undefined
    ? clockTime(observeDeadline)
    : undefined;
}

function configuredMode(): ProtectionMode {
  return protectionMode(
    vscode.workspace.getConfiguration("secretGuard").inspect<unknown>("mode")
      ?.globalValue,
  );
}

function configuredAutoEnable(): boolean {
  return vscode.workspace
    .getConfiguration("secretGuard")
    .get<boolean>("hook.autoEnable", true);
}

async function openCodexHookReview(): Promise<void> {
  const terminal = vscode.window.createTerminal({
    name: "Secret Guard — approbation Codex",
  });
  terminal.show();
  terminal.sendText("codex", true);
  await vscode.window.showInformationMessage(
    "Dans le terminal Codex, choisissez Review hooks, ouvrez UserPromptSubmit et approuvez uniquement le hook xSOM. Créez ensuite un nouveau chat Codex.",
  );
}

async function offerCodexFinalization(): Promise<void> {
  const selected = await vscode.window.showWarningMessage(
    "Secret Guard est configuré et ses canaris locaux sont validés. Codex exige encore une approbation explicite avant d’exécuter ce hook utilisateur hors sandbox.",
    FINISH_CODEX_SETUP,
  );
  if (selected === FINISH_CODEX_SETUP) await openCodexHookReview();
}

async function copyRedacted(content?: unknown): Promise<void> {
  if (typeof content !== "string") {
    await vscode.window.showInformationMessage(
      "Aucune version expurgée n’est disponible.",
    );
    return;
  }
  await vscode.env.clipboard.writeText(content);
  await vscode.window.showInformationMessage(
    "Version expurgée copiée localement.",
  );
}

async function presentScan(
  input: ScanInput & { sourceKind: LastScan["source"] },
  onScanned: () => Promise<void>,
): Promise<void> {
  const result = scan(input);
  lastScan = {
    source: input.sourceKind,
    decision: result.decision,
    findings: result.findings.length,
    complete: result.complete,
    time: scanTime(),
  };
  await onScanned();
  gateway?.record({
    kind: "scan",
    assistant: "manual",
    mode: configuredMode(),
    outcome: result.decision === "ALLOW" ? "clean" : "warned",
    findings: result.findings.length,
  });
  if (result.decision === "ALLOW") {
    await vscode.window.showInformationMessage(modalReport(result));
    return;
  }

  const sanitized = result.complete ? redactAndRescan(input) : undefined;
  const redactedContent =
    sanitized?.final.complete === true &&
    sanitized.final.decision === "ALLOW" &&
    sanitized.final.findings.length === 0
      ? sanitized.content
      : undefined;
  const action =
    redactedContent === undefined ? undefined : "Copier la version expurgée";
  const selected =
    result.decision === "BLOCK"
      ? await vscode.window.showErrorMessage(
          modalReport(result),
          { modal: true },
          ...(action ? [action] : []),
        )
      : await vscode.window.showWarningMessage(
          modalReport(result),
          { modal: true },
          ...(action ? [action] : []),
        );
  if (selected === action) await copyRedacted(redactedContent);
}

async function warningChoice(): Promise<WarnChoice> {
  const choice = await vscode.window.showWarningMessage(
    "Secret Guard a détecté un contenu ambigu. La valeur n’est pas affichée.",
    { modal: true },
    "Envoyer la version expurgée",
    "Envoyer quand même",
  );
  if (choice === "Envoyer la version expurgée") return "redact";
  return choice === "Envoyer quand même" ? "send" : "cancel";
}

function textReference(label: string, content: string): ResolvedReference {
  return decodeScannableText(new TextEncoder().encode(content)) === undefined
    ? { status: "unreadable", label }
    : { status: "text", label, content };
}

// An open editor wins over the disk so unsaved edits are what gets checked.
async function readUriReference(uri: vscode.Uri): Promise<ResolvedReference> {
  const label = vscode.workspace.asRelativePath(uri);
  const open = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString(),
  );
  if (open !== undefined) return textReference(label, open.getText());
  try {
    const metadata = await vscode.workspace.fs.stat(uri);
    if (
      (metadata.type & vscode.FileType.File) === 0 ||
      metadata.size > MAX_INPUT_BYTES
    )
      return { status: "unreadable", label };
    const content = decodeScannableText(
      await vscode.workspace.fs.readFile(uri),
    );
    return content === undefined
      ? { status: "unreadable", label }
      : { status: "text", label, content };
  } catch {
    return { status: "unreadable", label };
  }
}

async function readLocationReference(
  location: vscode.Location,
): Promise<ResolvedReference> {
  const { start, end } = location.range;
  const label = `${vscode.workspace.asRelativePath(location.uri)}:${String(start.line + 1)}-${String(end.line + 1)}`;
  try {
    const document = await vscode.workspace.openTextDocument(location.uri);
    return textReference(label, document.getText(location.range));
  } catch {
    return { status: "unreadable", label };
  }
}

function resolveReference(
  reference: vscode.ChatPromptReference,
): Promise<ResolvedReference> {
  const { value } = reference;
  const label = reference.modelDescription ?? reference.id;
  if (typeof value === "string")
    return Promise.resolve(textReference(label, value));
  if (value instanceof vscode.Uri) return readUriReference(value);
  if (value instanceof vscode.Location) return readLocationReference(value);
  return Promise.resolve({ status: "unreadable", label });
}

async function handleChat(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const mode = configuredMode();
  const references = await Promise.all(
    request.references.map(resolveReference),
  );
  const unreadable = references.filter(
    (reference) => reference.status === "unreadable",
  );
  if (unreadable.length > 0) {
    gateway?.record({
      kind: "scan",
      assistant: "secretguard",
      mode,
      outcome: "blocked",
      findings: 0,
    });
    stream.markdown(
      unreadableReferencesMessage(unreadable.map(({ label }) => label)),
    );
    return;
  }
  const content = composePrompt(
    request.prompt,
    references.filter(
      (reference): reference is ReferenceText => reference.status === "text",
    ),
  );

  let response: vscode.LanguageModelChatResponse | undefined;
  let outcome: DispatchOutcome;
  try {
    outcome = await dispatchGuarded(content, {
      mode,
      notifyWarning: () => {
        stream.markdown(
          "👁️ **Mode Avertir** · Le texte original est transmis sans nettoyage malgré une détection ou une analyse incomplète.\n\n",
        );
        return Promise.resolve();
      },
      chooseForWarning: () => warningChoice(),
      transport: async (guarded) => {
        response = await request.model.sendRequest(
          [vscode.LanguageModelChatMessage.User(guarded)],
          {},
          token,
        );
      },
    });
  } catch {
    stream.markdown(
      "$(error) Le modèle sélectionné n’a pas pu traiter la requête. Aucun nouvel envoi automatique ne sera tenté.",
    );
    return;
  }

  gateway?.record({
    kind: "scan",
    assistant: "secretguard",
    mode,
    outcome: !outcome.sent
      ? "blocked"
      : outcome.redacted
        ? "redacted"
        : "passed",
    findings: outcome.initial.findings.length,
  });
  if (!outcome.sent || response === undefined) {
    stream.markdown(markdownReport(outcome.final));
    const sanitized = outcome.initial.complete
      ? redactAndRescan({ content, sourceKind: "prompt" })
      : undefined;
    if (
      sanitized?.final.complete &&
      sanitized.final.decision === "ALLOW" &&
      sanitized.final.findings.length === 0
    ) {
      stream.button({
        command: "secretGuard.copyRedacted",
        title: "Copier la version expurgée",
        arguments: [sanitized.content],
      });
    }
    return;
  }
  if (outcome.redacted) {
    stream.markdown("_Version expurgée et rescannée avant envoi._\n\n");
  }
  try {
    for await (const fragment of response.text) stream.markdown(fragment);
  } catch {
    stream.markdown(
      "\n\n$(error) La réponse du modèle a été interrompue. Aucun nouvel envoi automatique ne sera tenté.",
    );
  }
}

async function saveMode(mode: ProtectionMode): Promise<void> {
  await vscode.workspace
    .getConfiguration("secretGuard")
    .update("mode", mode, vscode.ConfigurationTarget.Global);
}

function scanTime(): string {
  return clockTime(Date.now());
}

const CLIPBOARD_AUDIT_OUTCOMES = {
  purge: { clean: "clean", purged: "redacted", failed: "blocked" },
  check: { clean: "clean", purged: "warned", failed: "warned" },
} as const;

// A purge rewrites the clipboard only with a sanitized text that rescanned
// clean; a check never writes it.
async function clipboardShortcut(
  action: "purge" | "check",
): Promise<PurgeFeedback> {
  const outcome: PurgeOutcome = purgeClipboardText(
    await vscode.env.clipboard.readText(),
  );
  const purged = action === "purge" && outcome.status === "purged";
  if (purged) await vscode.env.clipboard.writeText(outcome.content);
  if (outcome.status !== "empty") {
    const findings = outcome.status === "clean" ? 0 : outcome.findings;
    lastScan = {
      source: "clipboard",
      decision: outcome.status === "clean" ? "ALLOW" : "BLOCK",
      findings,
      complete: !(
        outcome.status === "failed" && outcome.reason === "incomplete"
      ),
      purged,
      time: scanTime(),
    };
    gateway?.record({
      kind: "scan",
      assistant: "manual",
      mode: configuredMode(),
      outcome: CLIPBOARD_AUDIT_OUTCOMES[action][outcome.status],
      findings,
    });
  }
  return action === "purge" ? purgeFeedback(outcome) : checkFeedback(outcome);
}

function tooltipAppearance(kind: vscode.ColorThemeKind): Appearance {
  return kind === vscode.ColorThemeKind.Light ||
    kind === vscode.ColorThemeKind.HighContrastLight
    ? "light"
    : "dark";
}

// The status text outside checks, and whether a hook is checking right now.
let idleStatusText = "$(shield) Secret Guard";
let idleBackground: vscode.ThemeColor | undefined;
let checkRunning = false;
// A purge result shown in place of the status text for a few seconds, where
// the developer just clicked.
let flash: PurgeFeedback | undefined;
const FLASH_MS = 4000;
// VS Code spins only a few built-in codicons, so the xSOM mark turns through
// pre-rotated glyphs of media/xsom-icons.ttf (a third of a turn per cycle).
const SPINNER_FRAMES = 6;
const SPINNER_FRAME_MS = 90;
let spinnerFrame = 0;

function showStatusText(item: vscode.StatusBarItem): void {
  if (checkRunning) {
    item.text = `$(xsom-mark-${String(spinnerFrame)}) Secret Guard : vérification…`;
    item.backgroundColor = idleBackground;
    return;
  }
  item.text = flash?.text ?? idleStatusText;
  item.backgroundColor =
    flash?.failed === true
      ? new vscode.ThemeColor("statusBarItem.errorBackground")
      : idleBackground;
}

async function updateStatus(
  item: vscode.StatusBarItem,
  manager: HookManager,
  modeApplicationFailed: boolean,
): Promise<HookHealth> {
  let health: HookHealth;
  try {
    health = await manager.getHealth();
  } catch {
    health = { state: "degraded", reason: "canary_failed", hosts: [] };
  }
  const mode = configuredMode();
  const until = observeUntil();
  const warning = new vscode.ThemeColor("statusBarItem.warningBackground");
  item.name = "Secret Guard · Protection des prompts";
  item.command = statusBarClickCommand(mode);
  idleBackground = undefined;
  if (health.state === "active") {
    idleStatusText = `$(shield) Secret Guard : ${modeShortLabel(mode)}${until === undefined ? "" : ` jusqu’à ${until}`}`;
    if (mode === "observe") idleBackground = warning;
  } else if (health.state === "partial") {
    idleStatusText = "$(shield) Secret Guard : à compléter";
  } else if (health.state === "degraded") {
    idleStatusText = "$(warning) Secret Guard : à vérifier";
    idleBackground = warning;
  } else {
    idleStatusText = "$(shield) Secret Guard : désactivé";
  }
  if (modeApplicationFailed) {
    idleStatusText = "$(warning) Secret Guard : niveau non appliqué";
    idleBackground = warning;
  }
  showStatusText(item);
  const tooltip = new vscode.MarkdownString(
    statusTooltipMarkdown({
      appearance: tooltipAppearance(vscode.window.activeColorTheme.kind),
      health,
      mode,
      ...(until === undefined ? {} : { observeUntil: until }),
      modeApplicationFailed,
      ...(gateway === undefined
        ? {}
        : {
            gateway: {
              state: gateway.state,
              status: gateway.status,
              ...(gateway.audit === undefined ? {} : { audit: gateway.audit }),
            },
          }),
      ...(lastScan === undefined ? {} : { lastScan }),
    }),
    true,
  );
  tooltip.supportHtml = true;
  tooltip.isTrusted = { enabledCommands: STATUS_TOOLTIP_COMMANDS };
  item.tooltip = tooltip;
  item.accessibilityInformation = {
    label: `Secret Guard : ${HEALTH_LABELS[health.state]}. ${mode === "redact" ? "Expurger le presse-papiers." : "Vérifier le presse-papiers."}`,
  };
  item.show();
  return health;
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const hosts = defaultHostDefinitions().filter(
    (host) => host.id !== "vscode" || supportsVsCodePromptHooks(vscode.version),
  );
  const manager = new HookManager(context, { hosts });
  gateway = new GatewayIntegration(context);
  context.subscriptions.push(gateway);
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  let spinner: ReturnType<typeof setInterval> | undefined;
  const stopSpinner = (): void => {
    if (spinner !== undefined) clearInterval(spinner);
    spinner = undefined;
  };
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  const showFlash = (feedback: PurgeFeedback): void => {
    if (flashTimer !== undefined) clearTimeout(flashTimer);
    flash = feedback;
    showStatusText(status);
    flashTimer = setTimeout(() => {
      flash = undefined;
      flashTimer = undefined;
      showStatusText(status);
    }, FLASH_MS);
  };
  context.subscriptions.push(
    status,
    new ActivityMonitor(context.globalStorageUri.fsPath, (running) => {
      checkRunning = running;
      stopSpinner();
      const reduceMotion =
        vscode.workspace
          .getConfiguration("workbench")
          .get<string>("reduceMotion") === "on";
      if (running && !reduceMotion)
        spinner = setInterval(() => {
          spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES;
          showStatusText(status);
        }, SPINNER_FRAME_MS);
      showStatusText(status);
    }),
    { dispose: stopSpinner },
    {
      dispose: () => {
        if (flashTimer !== undefined) clearTimeout(flashTimer);
      },
    },
  );
  // An open status bar hover is a snapshot VS Code never refreshes. Re-adding
  // the item detaches the hover's target, which closes it, so acting from the
  // controls never leaves stale state on screen.
  const closeStatusControls = (): void => {
    status.hide();
    status.show();
  };

  const storage = context.globalStorageUri.fsPath;
  let observeTimer: ReturnType<typeof setTimeout> | undefined;
  const expireObserveWindow = async (): Promise<void> => {
    if (configuredMode() !== "observe") return;
    await saveMode("redact");
    void vscode.window.showInformationMessage(
      "⏱️ L’heure en mode Avertir est écoulée : Secret Guard repasse en Expurger.",
    );
  };
  // Avertir never outlives its window: the hook falls back to Expurger on its
  // own, and this timer switches the setting back while VS Code is open.
  const scheduleObserveExpiry = (): void => {
    if (observeTimer !== undefined) clearTimeout(observeTimer);
    observeTimer = undefined;
    const deadline = readObserveDeadline(storage);
    observeDeadline = deadline;
    if (configuredMode() !== "observe") return;
    const now = Date.now();
    const remaining =
      deadline !== undefined && observeWindowOpen(deadline, now)
        ? deadline - now
        : 0;
    observeTimer = setTimeout(() => {
      void expireObserveWindow();
    }, remaining);
  };
  // Choosing Avertir opens a fresh window; leaving it closes the window.
  const syncObserveWindow = async (): Promise<void> => {
    if (configuredMode() === "observe")
      await openObserveWindow(storage, Date.now());
    else await closeObserveWindow(storage);
    scheduleObserveExpiry();
  };
  const confirmMode = async (mode: ProtectionMode): Promise<boolean> => {
    if (mode !== "observe" || configuredMode() === "observe") return true;
    const answer = await vscode.window.showWarningMessage(
      "Avertir transmet vos messages tels quels à l’assistant, secrets compris. Ce mode dure 1 heure, puis Secret Guard repasse en Expurger.",
      { modal: true },
      OBSERVE_CONFIRMATION,
    );
    return answer === OBSERVE_CONFIRMATION;
  };
  context.subscriptions.push({
    dispose: () => {
      if (observeTimer !== undefined) clearTimeout(observeTimer);
    },
  });

  let panel: vscode.WebviewPanel | undefined;
  let modeApplicationFailed = false;
  let modeUpdate = Promise.resolve();
  let lastEditor = vscode.window.activeTextEditor;
  const refreshUi = async (): Promise<void> => {
    const health = await updateStatus(status, manager, modeApplicationFailed);
    if (panel !== undefined) {
      panel.webview.html = dashboardHtml(
        health,
        configuredMode(),
        randomBytes(16).toString("hex"),
        modeApplicationFailed,
        gateway?.summary,
      );
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("secretGuard.connectGateway", async () => {
      closeStatusControls();
      await gateway?.connect();
      await refreshUi();
    }),
    vscode.commands.registerCommand(
      "secretGuard.disconnectGateway",
      async () => {
        closeStatusControls();
        const answer = await vscode.window.showWarningMessage(
          "Déconnecter xSOM retire le nettoyage transparent de Claude dans les nouvelles sessions. Les hooks locaux restent actifs.",
          { modal: true },
          "Déconnecter",
        );
        if (answer === "Déconnecter") {
          await gateway?.disconnect();
          await refreshUi();
        }
      },
    ),
    vscode.commands.registerCommand("secretGuard.chooseMode", async () => {
      const selected = await vscode.window.showQuickPick(
        PROTECTION_MODES.map((entry) => ({
          ...entry,
          picked: entry.mode === configuredMode(),
        })),
        {
          title: "Secret Guard · Mode de protection",
          placeHolder: "Comment traiter vos prochains messages ?",
          matchOnDescription: true,
        },
      );
      if (selected !== undefined && (await confirmMode(selected.mode)))
        await saveMode(selected.mode);
    }),
    vscode.commands.registerCommand(
      "secretGuard.setMode",
      async (mode?: unknown) => {
        closeStatusControls();
        if (isProtectionMode(mode) && (await confirmMode(mode)))
          await saveMode(mode);
      },
    ),
    vscode.window.onDidChangeActiveColorTheme(async () => {
      await refreshUi();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor !== undefined) lastEditor = editor;
    }),
    vscode.commands.registerCommand("secretGuard.showDashboard", async () => {
      closeStatusControls();
      if (panel === undefined) {
        panel = vscode.window.createWebviewPanel(
          "secretGuard.dashboard",
          "Secret Guard",
          vscode.ViewColumn.Beside,
          {
            enableScripts: false,
            enableForms: false,
            localResourceRoots: [],
            enableCommandUris: [...DASHBOARD_COMMANDS],
          },
        );
        panel.iconPath = new vscode.ThemeIcon("shield");
        panel.onDidDispose(() => {
          panel = undefined;
        });
        context.subscriptions.push(panel);
      } else panel.reveal();
      await refreshUi();
    }),
  );

  // Avertir left on by an earlier session: an expired window ends now, and a
  // setting without a window (edited by hand, or kept from 0.5) starts one.
  try {
    if (configuredMode() === "observe") {
      const deadline = readObserveDeadline(storage);
      if (deadline === undefined) await openObserveWindow(storage, Date.now());
      else if (!observeWindowOpen(deadline, Date.now()))
        await saveMode("redact");
    }
  } catch {
    // Without a readable window the hook already applies Expurger.
  }
  scheduleObserveExpiry();

  try {
    const initial = await manager.getHealth();
    const strategy = activationStrategy(
      initial.state,
      configuredAutoEnable(),
      context.extensionMode === vscode.ExtensionMode.Test,
    );
    if (strategy === "enable") {
      await manager.enable(configuredMode());
    } else {
      await manager.refreshIfConfigured(configuredMode());
    }
  } catch {
    // Activation must preserve manual scanning even if the optional hook fails.
  }
  await refreshUi();

  if (context.extensionMode !== vscode.ExtensionMode.Test) {
    void gateway
      .restore()
      .then(async () => {
        const health = await manager.getHealth();
        gateway?.record({
          kind: "local_test",
          assistant: "manual",
          mode: configuredMode(),
          outcome:
            health.reason === "local_canaries_verified" ? "passed" : "failed",
          findings: 0,
        });
        await refreshUi();
      })
      .catch(() => undefined);
  }

  const notify = async (feedback: PurgeFeedback): Promise<void> => {
    if (feedback.message === undefined) return;
    if (feedback.offerPurge !== true) {
      await vscode.window.showErrorMessage(feedback.message);
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      feedback.message,
      PURGE_ACTION,
    );
    if (choice === PURGE_ACTION)
      await vscode.commands.executeCommand(PURGE_CLIPBOARD_COMMAND);
  };
  const runClipboardShortcut = async (
    action: "purge" | "check",
  ): Promise<void> => {
    closeStatusControls();
    let feedback: PurgeFeedback;
    try {
      feedback = await clipboardShortcut(action);
    } catch {
      feedback = action === "purge" ? PURGE_UNAVAILABLE : CHECK_UNAVAILABLE;
    }
    // Feedback first: the developer is on the way to the prompt box.
    showFlash(feedback);
    void notify(feedback);
    await refreshUi();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("secretGuard.scanSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      const content = editor?.document.getText(editor.selection) ?? "";
      await presentScan(
        {
          content,
          sourceKind: "selection",
          ...(editor === undefined
            ? {}
            : { languageId: editor.document.languageId }),
        },
        refreshUi,
      );
    }),
    vscode.commands.registerCommand("secretGuard.scanClipboard", async () => {
      closeStatusControls();
      await presentScan(
        {
          content: await vscode.env.clipboard.readText(),
          sourceKind: "clipboard",
        },
        refreshUi,
      );
    }),
    vscode.commands.registerCommand(PURGE_CLIPBOARD_COMMAND, () =>
      runClipboardShortcut("purge"),
    ),
    vscode.commands.registerCommand(CHECK_CLIPBOARD_COMMAND, () =>
      runClipboardShortcut("check"),
    ),
    vscode.commands.registerCommand("secretGuard.scanDocument", async () => {
      const editor = vscode.window.activeTextEditor ?? lastEditor;
      if (editor === undefined || editor.document.isClosed) {
        await vscode.window.showInformationMessage("Aucun document ouvert.");
        return;
      }
      await presentScan(
        {
          content: editor.document.getText(),
          sourceKind: "document",
          languageId: editor.document.languageId,
        },
        refreshUi,
      );
    }),
    vscode.commands.registerCommand("secretGuard.copyRedacted", copyRedacted),
    vscode.commands.registerCommand(
      "secretGuard.finishCodexSetup",
      openCodexHookReview,
    ),
    vscode.commands.registerCommand("secretGuard.enableHook", async () => {
      closeStatusControls();
      try {
        await manager.enable(configuredMode());
        modeApplicationFailed = false;
        await refreshUi();
        await offerCodexFinalization();
      } catch {
        await refreshUi();
        await vscode.window.showErrorMessage(
          "Activation refusée : configuration non gérée, droits insuffisants ou canari local en échec.",
        );
      }
    }),
    vscode.commands.registerCommand("secretGuard.disableHook", async () => {
      try {
        await manager.disable();
        await refreshUi();
        await vscode.window.showInformationMessage(
          "Hooks automatiques Secret Guard retirés sans modifier les autres hooks.",
        );
      } catch {
        await refreshUi();
        await vscode.window.showErrorMessage(
          "Suppression refusée : le fichier de hook n’est pas géré par Secret Guard.",
        );
      }
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration("secretGuard.mode")) return;
      modeUpdate = modeUpdate.then(async () => {
        gateway?.record({
          kind: "mode_changed",
          assistant: "manual",
          mode: configuredMode(),
          outcome: "configured",
          findings: 0,
        });
        try {
          await syncObserveWindow();
          const health = await manager.refreshIfConfigured(configuredMode());
          if (health.state === "degraded") throw new Error("mode_not_applied");
          modeApplicationFailed = false;
          const until = observeUntil();
          void vscode.window.showInformationMessage(
            `${modeLabel(configuredMode())}${until === undefined ? "" : ` jusqu’à ${until}, puis retour automatique à Expurger`} · Réglage enregistré. Ouvrez une nouvelle session de votre assistant pour utiliser les hooks actualisés.`,
          );
        } catch {
          modeApplicationFailed = true;
          void vscode.window.showErrorMessage(
            "Le mode est enregistré, mais son application aux assistants a échoué. Ouvrez Secret Guard puis Configurer la protection pour réessayer.",
          );
        }
        await refreshUi();
      });
      await modeUpdate;
    }),
  );

  const participant = vscode.chat.createChatParticipant(
    "xsom.secretGuard",
    handleChat,
  );
  participant.iconPath = new vscode.ThemeIcon("shield");
  context.subscriptions.push(participant);
}

export function deactivate(): void {
  // All resources are owned by context.subscriptions.
}
