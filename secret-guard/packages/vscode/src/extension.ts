import * as vscode from "vscode";

import { redactAndRescan, scan, type ScanInput } from "@xsom/secret-guard-core";

import {
  dispatchGuarded,
  type DispatchOutcome,
  type WarnChoice,
} from "./dispatch.js";
import { HookManager, type HookHealth } from "./hook-manager.js";
import { markdownReport, modalReport } from "./presentation.js";

function configuredWarnMode(): "allow" | "block" {
  return vscode.workspace
    .getConfiguration("secretGuard")
    .get<"allow" | "block">("hook.warnMode", "block");
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

async function presentScan(input: ScanInput): Promise<void> {
  const result = scan(input);
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

async function handleChat(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  if (request.references.length > 0) {
    stream.markdown(
      "$(lock) **Envoi bloqué.** La V0 ne scanne pas encore le contenu résolu des pièces jointes ou références.",
    );
    return;
  }

  const result = scan({ content: request.prompt, sourceKind: "prompt" });
  if (result.decision === "BLOCK" || !result.complete) {
    const sanitized = result.complete
      ? redactAndRescan({ content: request.prompt, sourceKind: "prompt" })
      : undefined;
    const redactedContent =
      sanitized?.final.complete === true &&
      sanitized.final.decision === "ALLOW" &&
      sanitized.final.findings.length === 0
        ? sanitized.content
        : undefined;
    stream.markdown(markdownReport(result));
    if (redactedContent !== undefined) {
      stream.button({
        command: "secretGuard.copyRedacted",
        title: "Copier la version expurgée",
        arguments: [redactedContent],
      });
    }
    return;
  }

  let response: vscode.LanguageModelChatResponse | undefined;
  let outcome: DispatchOutcome;
  try {
    outcome = await dispatchGuarded(request.prompt, {
      chooseForWarning: () => warningChoice(),
      transport: async (content) => {
        response = await request.model.sendRequest(
          [vscode.LanguageModelChatMessage.User(content)],
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

  if (!outcome.sent || response === undefined) {
    stream.markdown(markdownReport(outcome.final));
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

async function updateStatus(
  item: vscode.StatusBarItem,
  manager: HookManager,
): Promise<void> {
  let health: HookHealth;
  try {
    health = await manager.getHealth();
  } catch {
    health = { state: "degraded", reason: "canary_failed" };
  }
  if (health.state === "preview") {
    item.text = "$(shield) Secret Guard: Preview validée";
    item.tooltip =
      "Le runner local a passé ses canaris. L’API VS Code reste en Preview et un hook workspace ou une politique peut prévaloir.";
    item.command = "secretGuard.disableHook";
  } else if (health.state === "degraded") {
    item.text = "$(warning) Secret Guard: dégradé";
    item.tooltip =
      "La configuration ou le canari local du hook est invalide. @secretguard et les scans manuels restent disponibles.";
    item.command = "secretGuard.enableHook";
  } else {
    item.text = "$(shield) Secret Guard: mode manuel";
    item.tooltip =
      "Les commandes et @secretguard sont disponibles, mais aucun hook utilisateur n’est configuré.";
    item.command = "secretGuard.enableHook";
  }
  item.show();
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const manager = new HookManager(context);
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  context.subscriptions.push(status);

  try {
    await manager.refreshIfConfigured(configuredWarnMode());
  } catch {
    // Activation must preserve manual scanning even if the optional hook fails.
  }
  await updateStatus(status, manager);

  context.subscriptions.push(
    vscode.commands.registerCommand("secretGuard.scanSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      const content = editor?.document.getText(editor.selection) ?? "";
      await presentScan({
        content,
        sourceKind: "selection",
        ...(editor === undefined
          ? {}
          : { languageId: editor.document.languageId }),
      });
    }),
    vscode.commands.registerCommand("secretGuard.scanClipboard", async () => {
      await presentScan({
        content: await vscode.env.clipboard.readText(),
        sourceKind: "clipboard",
      });
    }),
    vscode.commands.registerCommand("secretGuard.scanDocument", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined) {
        await vscode.window.showInformationMessage("Aucun document ouvert.");
        return;
      }
      await presentScan({
        content: editor.document.getText(),
        sourceKind: "document",
        languageId: editor.document.languageId,
      });
    }),
    vscode.commands.registerCommand("secretGuard.copyRedacted", copyRedacted),
    vscode.commands.registerCommand("secretGuard.enableHook", async () => {
      try {
        await manager.enable(configuredWarnMode());
        await updateStatus(status, manager);
        await vscode.window.showInformationMessage(
          "Canaris locaux validés et hook UserPromptSubmit configuré. L’API est en Preview et un hook workspace ou une politique peut prévaloir.",
        );
      } catch {
        await updateStatus(status, manager);
        await vscode.window.showErrorMessage(
          "Activation refusée : configuration non gérée, droits insuffisants ou canari local en échec.",
        );
      }
    }),
    vscode.commands.registerCommand("secretGuard.disableHook", async () => {
      try {
        await manager.disable();
        await updateStatus(status, manager);
        await vscode.window.showInformationMessage("Hook Secret Guard retiré.");
      } catch {
        await updateStatus(status, manager);
        await vscode.window.showErrorMessage(
          "Suppression refusée : le fichier de hook n’est pas géré par Secret Guard.",
        );
      }
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration("secretGuard.hook.warnMode")) return;
      try {
        await manager.refreshIfConfigured(configuredWarnMode());
      } catch {
        // Status below exposes the degraded state without disabling manual mode.
      }
      await updateStatus(status, manager);
    }),
  );

  const participant = vscode.chat.createChatParticipant(
    "xsom.secretGuard",
    handleChat,
  );
  context.subscriptions.push(participant);
}

export function deactivate(): void {
  // All resources are owned by context.subscriptions.
}
