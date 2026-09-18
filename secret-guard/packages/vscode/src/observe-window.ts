import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProtectionMode } from "@xsom/secret-guard-cli/hook";

/** How long Avertir lasts before Secret Guard falls back to Expurger. */
export const OBSERVE_WINDOW_MS = 60 * 60 * 1000;

// Kept next to the installed hook, which reads it on every Avertir check: the
// window closes even when VS Code is not running to switch the mode back.
const DEADLINE_FILE = "observe-until";

export function readObserveDeadline(storage: string): number | undefined {
  try {
    const value = Number(
      readFileSync(join(storage, DEADLINE_FILE), "utf8").trim(),
    );
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether an Avertir window is running at `now`. A missing, unreadable,
 * expired or longer-than-allowed deadline closes it.
 */
export function observeWindowOpen(
  deadline: number | undefined,
  now: number,
): boolean {
  return (
    deadline !== undefined &&
    now < deadline &&
    deadline - now <= OBSERVE_WINDOW_MS
  );
}

/** The mode the hook applies: Avertir outside its window is Expurger. */
export function effectiveMode(
  mode: ProtectionMode,
  deadline: number | undefined,
  now: number,
): ProtectionMode {
  if (mode !== "observe") return mode;
  return observeWindowOpen(deadline, now) ? "observe" : "redact";
}

export async function openObserveWindow(
  storage: string,
  now: number,
): Promise<number> {
  const deadline = now + OBSERVE_WINDOW_MS;
  await mkdir(storage, { recursive: true });
  await writeFile(join(storage, DEADLINE_FILE), String(deadline), {
    mode: 0o600,
  });
  return deadline;
}

export async function closeObserveWindow(storage: string): Promise<void> {
  await rm(join(storage, DEADLINE_FILE), { force: true });
}
