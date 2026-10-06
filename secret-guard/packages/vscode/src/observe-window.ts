import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProtectionMode } from "@xsom/secret-guard-cli/hook";

/**
 * How long Avertir may last, chosen from the control panel. The longest choice
 * is also the ceiling the hook enforces: a deadline further away was not
 * written by Secret Guard and closes the window.
 */
export const OBSERVE_DURATIONS = [15, 60, 240, 480] as const;
export type ObserveMinutes = (typeof OBSERVE_DURATIONS)[number];
export const DEFAULT_OBSERVE_MINUTES: ObserveMinutes = 60;
export const OBSERVE_WINDOW_MAX_MS = Math.max(...OBSERVE_DURATIONS) * 60 * 1000;

export function isObserveMinutes(value: unknown): value is ObserveMinutes {
  return OBSERVE_DURATIONS.some((minutes) => minutes === value);
}

/**
 * The organization's cap on Avertir, from its verified signed policy: 0
 * forbids Avertir, a length bounds it. Undefined: no organization cap, the
 * 8-hour ceiling alone applies. A cap only ever shortens a window.
 */
export type ObserveCap = 0 | ObserveMinutes | undefined;

/** The lengths the panel and the activation modal may offer. */
export function observeDurationsWithin(
  cap: ObserveCap,
): readonly ObserveMinutes[] {
  return OBSERVE_DURATIONS.filter(
    (minutes) => cap === undefined || minutes <= cap,
  );
}

/** The preferred length, shortened to the cap; undefined when forbidden. */
export function cappedObserveMinutes(
  minutes: ObserveMinutes,
  cap: ObserveCap,
): ObserveMinutes | undefined {
  if (cap === 0) return undefined;
  return cap === undefined || minutes <= cap ? minutes : cap;
}

/** « plafonné à 1 h par votre organisation », or why Avertir is unavailable. */
export function observeCapLine(cap: ObserveCap): string | undefined {
  if (cap === undefined) return undefined;
  return cap === 0
    ? "Avertir est désactivé par votre organisation"
    : `plafonné à ${observeDurationLabel(cap)} par votre organisation`;
}

function observeLimitMs(cap: ObserveCap): number {
  return cap === undefined
    ? OBSERVE_WINDOW_MAX_MS
    : Math.min(OBSERVE_WINDOW_MAX_MS, cap * 60 * 1000);
}

/** « 15 min », « 1 h », « 4 h », « 8 h ». */
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
 * Whether an Avertir window is running at `now`. A missing, unreadable or
 * expired deadline closes it, and so does one further away than allowed: the
 * 8-hour ceiling, or the organization's cap when lower (0 closes every window).
 */
export function observeWindowOpen(
  deadline: number | undefined,
  now: number,
  cap?: ObserveCap,
): boolean {
  return (
    deadline !== undefined &&
    now < deadline &&
    deadline - now <= observeLimitMs(cap)
  );
}

/** The mode the hook applies: Avertir outside its window is Expurger. */
export function effectiveMode(
  mode: ProtectionMode,
  deadline: number | undefined,
  now: number,
  cap?: ObserveCap,
): ProtectionMode {
  if (mode !== "observe") return mode;
  return observeWindowOpen(deadline, now, cap) ? "observe" : "redact";
}

/**
 * What a newly verified cap asks of a running Avertir window: end it (cap 0),
 * shorten it to the cap from now (more time left than the cap), or nothing.
 */
export function observeCapChange(
  deadline: number | undefined,
  now: number,
  cap: ObserveCap,
): "none" | "forbid" | "shorten" {
  if (cap === undefined) return "none";
  if (cap === 0) return "forbid";
  return deadline !== undefined && deadline - now > cap * 60 * 1000
    ? "shorten"
    : "none";
}

/**
 * What a change of the mode setting does to the window. The setting is shared
 * by every VS Code window and each one reacts to it, so a running window is
 * kept: the window where the length was chosen already wrote it, and another
 * must not restart it with its own, older length. Avertir with no running
 * window (set by hand) starts one.
 */
export function observeWindowOnModeChange(
  mode: ProtectionMode,
  deadline: number | undefined,
  now: number,
  cap?: ObserveCap,
): "close" | "keep" | "open" {
  if (mode !== "observe") return "close";
  return observeWindowOpen(deadline, now, cap) ? "keep" : "open";
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
