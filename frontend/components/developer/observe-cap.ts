/**
 * Le plafond d'Avertir d'une politique Secret Guard, lu et écrit dans le JSON que
 * l'administrateur compose. Le JSON reste l'unique source : le choix ne fait que le
 * réécrire, et la plateforme valide puis signe ce qui est publié.
 *
 * `null` : aucun plafond de l'organisation (le poste garde son propre plafond de 8 h) ;
 * `0` : Avertir interdit. Contrat : `secret-guard/contracts/policy.schema.json`.
 */

import type { StrKey } from "@/lib/strings";

export const OBSERVE_CAP_CHOICES = [null, 240, 60, 15, 0] as const;
export type ObserveCap = (typeof OBSERVE_CAP_CHOICES)[number];

/** Le plafond du JSON, ou pourquoi on ne peut pas le lire. */
export type ObserveCapReading = ObserveCap | "unreadable" | "unknown";

type PolicyDraft = Record<string, unknown>;

function parseDraft(body: string): PolicyDraft | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as PolicyDraft)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Un plafond publié ; 480 min équivaut à l'absence : c'est déjà la limite du poste. */
export function normalizeObserveCap(value: unknown): ObserveCapReading {
  if (value === undefined || value === null || value === 480) return null;
  return OBSERVE_CAP_CHOICES.find((choice) => choice === value) ?? "unknown";
}

export function readObserveCap(body: string): ObserveCapReading {
  const draft = parseDraft(body);
  if (draft === undefined) return "unreadable";
  if (!("workstation" in draft)) return null;
  const settings = draft.workstation;
  if (typeof settings !== "object" || settings === null) return "unknown";
  const keys = Object.keys(settings);
  const value = (settings as { observeMaxMinutes?: unknown }).observeMaxMinutes;
  // Écrit, `null` n'est pas « aucun plafond » : la plateforme le refuse.
  if (keys.length !== 1 || value === undefined || value === null)
    return "unknown";
  return normalizeObserveCap(value);
}

/** Le JSON avec ce plafond, ou `undefined` s'il ne se lit pas. */
export function withObserveCap(
  body: string,
  cap: ObserveCap,
): string | undefined {
  const draft = parseDraft(body);
  if (draft === undefined) return undefined;
  const next: PolicyDraft = { ...draft };
  delete next.workstation;
  if (cap !== null) next.workstation = { observeMaxMinutes: cap };
  return JSON.stringify(next, null, 2);
}

const OPTION_KEYS: Record<string, StrKey> = {
  none: "devpol.cap.none",
  240: "devpol.cap.240",
  60: "devpol.cap.60",
  15: "devpol.cap.15",
  0: "devpol.cap.0",
};

const SUMMARY_KEYS: Record<string, StrKey> = {
  none: "devpol.summary.none",
  240: "devpol.summary.240",
  60: "devpol.summary.60",
  15: "devpol.summary.15",
  0: "devpol.summary.0",
};

export function observeCapOption(cap: ObserveCap): StrKey {
  return OPTION_KEYS[cap === null ? "none" : String(cap)] ?? "devpol.cap.none";
}

export function observeCapSummary(cap: ObserveCap): StrKey {
  return (
    SUMMARY_KEYS[cap === null ? "none" : String(cap)] ?? "devpol.summary.none"
  );
}
