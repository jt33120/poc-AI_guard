import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  readOptional,
  restoreOptional,
  writeAtomically,
} from "./config-files.js";
import {
  defaultHostDefinitions,
  removeMarkedHooks,
  type HostDefinition,
} from "./host-config.js";

// The hooks live in the assistants' own settings, which VS Code does not
// clean when the extension is uninstalled. The extension records where it is
// installed so the hook, which runs without VS Code, can tell it was removed.
const INSTALLATION_FILE = "installation.json";
// VS Code's index of the installed extensions, kept next to their folders.
const EXTENSIONS_MANIFEST = "extensions.json";

export interface Installation {
  readonly extensionId: string;
  readonly extensionsDir: string;
}

export async function recordInstallation(
  storage: string,
  installation: Installation,
): Promise<void> {
  await writeAtomically(
    join(storage, INSTALLATION_FILE),
    `${JSON.stringify(installation)}\n`,
  );
}

async function readInstallation(
  storage: string,
): Promise<Installation | undefined> {
  try {
    const value = JSON.parse(
      await readFile(join(storage, INSTALLATION_FILE), "utf8"),
    ) as Partial<Installation>;
    if (
      typeof value.extensionId !== "string" ||
      value.extensionId === "" ||
      typeof value.extensionsDir !== "string" ||
      value.extensionsDir === ""
    )
      return undefined;
    return {
      extensionId: value.extensionId,
      extensionsDir: value.extensionsDir,
    };
  } catch {
    return undefined;
  }
}

function listsExtension(manifest: unknown[], extensionId: string): boolean {
  const wanted = extensionId.toLowerCase();
  return manifest.some((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const identifier = (entry as { identifier?: { id?: unknown } }).identifier;
    return (
      typeof identifier?.id === "string" &&
      identifier.id.toLowerCase() === wanted
    );
  });
}

/**
 * True only when VS Code's own index proves the extension is gone. A missing
 * record, a development install or an unreadable index keeps the guard on.
 */
export async function extensionRemoved(storage: string): Promise<boolean> {
  const installation = await readInstallation(storage);
  if (installation === undefined) return false;
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      await readFile(
        join(installation.extensionsDir, EXTENSIONS_MANIFEST),
        "utf8",
      ),
    );
  } catch {
    return false;
  }
  return (
    Array.isArray(manifest) &&
    !listsExtension(manifest, installation.extensionId)
  );
}

/** Removes the managed entries from every assistant; each file on its own. */
export async function removeManagedHooks(
  hosts: readonly HostDefinition[] = defaultHostDefinitions(),
): Promise<void> {
  for (const host of hosts) {
    try {
      const content = await readOptional(host.configPath);
      const next = removeMarkedHooks(content);
      if (next !== content) await restoreOptional(host.configPath, next);
    } catch {
      // An unreadable file is left as the user wrote it.
    }
  }
}

/** What the hook does once the extension is gone: unhook and delete itself. */
export async function retireHook(
  hookPath: string,
  hosts?: readonly HostDefinition[],
): Promise<void> {
  await removeManagedHooks(hosts);
  await rm(hookPath, { force: true });
}
