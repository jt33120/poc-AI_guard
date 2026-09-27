import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProtectionMode } from "@xsom/secret-guard-cli/hook";

/**
 * How long Avertir may last, chosen from the control panel. The longest choice
 * is also the ceiling the hook enforces: a deadline further away was not
 * written by Secret Guard and closes the window.
 */
export const OBSERVE_DURATIONS = [15, 60, 240] as const;
export type ObserveMinutes = (typeof OBSERVE_DURATIONS)[number];
export const DEFAULT_OBSERVE_MINUTES: ObserveMinutes = 60;
export const OBSERVE_WINDOW_MAX_MS = Math.max(...OBSERVE_DURATIONS) * 60 * 1000;

export function isObserveMinutes(value: unknown): value is ObserveMinutes {
  return OBSERVE_DURATIONS.some((minutes) => minutes === value);
}

/** « 15 min », « 1 h », « 4 h ». */
export function observeDurationLabel(minutes: ObserveMinutes): string {
  return minutes < 60 ? `${String(minutes)} min` : `${String(minutes / 60)} h`;
}

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
    deadline - now <= OBSERVE_WINDOW_MAX_MS
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
  minutes: ObserveMinutes = DEFAULT_OBSERVE_MINUTES,
): Promise<number> {
  const chosen = isObserveMinutes(minutes) ? minutes : DEFAULT_OBSERVE_MINUTES;
  const deadline = now + chosen * 60 * 1000;
  await mkdir(storage, { recursive: true });
  await writeFile(join(storage, DEADLINE_FILE), String(deadline), {
    mode: 0o600,
  });
  return deadline;
}

export async function closeObserveWindow(storage: string): Promise<void> {
  await rm(join(storage, DEADLINE_FILE), { force: true });
}
