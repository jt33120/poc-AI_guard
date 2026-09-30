import type * as vscode from "vscode";
import { activateProtection } from "./protection.js";

// The open source build: Secret Guard Local alone, without the Équipe edition.
export function activate(context: vscode.ExtensionContext): Promise<void> {
  return activateProtection(context);
}

export function deactivate(): void {
  // All resources are owned by context.subscriptions.
}
