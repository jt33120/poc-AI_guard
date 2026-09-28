import type * as vscode from "vscode";
import { activateProtection } from "./protection.js";
import { createTeam } from "./team/index.js";

// The official build: Secret Guard Local with the Équipe edition plugged in.
// The open source build starts from local-extension.ts instead.
export function activate(context: vscode.ExtensionContext): Promise<void> {
  return activateProtection(context, createTeam);
}

export function deactivate(): void {
  // All resources are owned by context.subscriptions.
}
