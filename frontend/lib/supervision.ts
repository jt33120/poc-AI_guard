// The supervision room's data: the shape of GET /v1/supervision, the grouping of
// the compliance buckets into the five families a chart can carry, and the
// formatting of counts, shares, durations and time ticks (FR and EN).

export type SupervisionWindow = "24h" | "7d" | "30d";
export const WINDOWS: readonly SupervisionWindow[] = ["24h", "7d", "30d"];

/** `core/export.py::BUCKETS`: every decision the guard writes lands in exactly one. */
export type BucketName =
  | "auto_allowed"
  | "allowed_with_notice"
  | "held_for_human"
  | "human_approved"
  | "refused"
  | "guard_recorded"
  | "observed_not_enforced"
  | "not_inspected"
  | "unclassified";

export type Buckets = Record<BucketName, number>;

export interface SeriesPoint {
  at: string;
  buckets: Buckets;
}

export interface LatencyPoint {
  at: string;
  samples: number;
  p50: number | null;
  p95: number | null;
}

export interface Supervision {
  window: SupervisionWindow;
  step_seconds: number;
  start: string;
  end: string;
  generated_at: string;
  total: number;
  buckets: Buckets;
  series: SeriesPoint[];
  latency: {
    samples: number;
    p50: number | null;
    p95: number | null;
    p99: number | null;
    series: LatencyPoint[];
  };
  classes: { action_class: string; total: number; buckets: Buckets }[];
  tools: { tool: string; total: number; held: number; refused: number }[];
  agents: {
    id: string;
    name: string | null;
    total: number;
    held: number;
    refused: number;
    last_active: string | null;
  }[];
  approvals: {
    created: number;
    approved: number;
    denied: number;
    expired: number;
    pending: number;
    median_decision_s: number | null;
    p90_decision_s: number | null;
    rubber_stamps: number;
    expiry_rate: number | null;
    histogram: { low_s: number; high_s: number | null; count: number }[];
    pending_now: number;
    oldest_pending_s: number | null;
    targets: {
      median_decision_s: number;
      expiry_rate: number;
      rubber_stamp_s: number;
    };
  };
  probes: {
    database_ms: number;
    chain_ok: boolean;
    chain_entries: number;
    chain_broken_id: number | null;
    last_checkpoint_at: string | null;
    last_checkpoint_entries: number | null;
    last_event_at: string | null;
  };
}

/**
 * Five families, in the stacking order the palette was validated in (adjacent
 * pairs clear the colour-vision checks in both themes). "none" gathers what is
 * not a verdict on an action: observation windows, guard events, uninspected
 * traffic and anything unclassified.
 */
export type Family = "allowed" | "notice" | "human" | "none" | "refused";
export const FAMILIES: readonly Family[] = [
  "allowed",
  "notice",
  "human",
  "none",
  "refused",
];

const FAMILY_OF: Record<BucketName, Family> = {
  auto_allowed: "allowed",
  allowed_with_notice: "notice",
  held_for_human: "human",
  human_approved: "human",
  refused: "refused",
  guard_recorded: "none",
  observed_not_enforced: "none",
  not_inspected: "none",
  unclassified: "none",
};

export type Lang = "fr" | "en";
type Text = Record<Lang, string>;

export const FAMILY_LABEL: Record<Family, Text> = {
  allowed: { fr: "Autorisé par la règle", en: "Allowed by rule" },
  notice: { fr: "Autorisé et signalé", en: "Allowed with notice" },
  human: { fr: "Tenu pour un humain", en: "Held for a human" },
  none: { fr: "Hors verdict", en: "No verdict" },
  refused: { fr: "Refusé", en: "Refused" },
};

export const BUCKET_LABEL: Record<BucketName, Text> = {
  auto_allowed: { fr: "autorisé", en: "allowed" },
  allowed_with_notice: { fr: "signalé", en: "with notice" },
  held_for_human: { fr: "en attente", en: "awaiting" },
  human_approved: { fr: "approuvé", en: "approved" },
  refused: { fr: "refusé", en: "refused" },
  guard_recorded: { fr: "événement de garde", en: "guard event" },
  observed_not_enforced: { fr: "observé sans bloquer", en: "observed" },
  not_inspected: { fr: "non inspecté", en: "not inspected" },
  unclassified: { fr: "non classé", en: "unclassified" },
};

export const CLASS_LABEL: Record<string, Text> = {
  read: { fr: "Lecture", en: "Read" },
  write: { fr: "Écriture", en: "Write" },
  external_send: { fr: "Envoi externe", en: "External send" },
  irreversible: { fr: "Irréversible", en: "Irreversible" },
  unclassified: { fr: "Non classée", en: "Unclassified" },
};

export function families(buckets: Buckets): Record<Family, number> {
  const out: Record<Family, number> = {
    allowed: 0,
    notice: 0,
    human: 0,
    none: 0,
    refused: 0,
  };
  for (const name of Object.keys(buckets) as BucketName[]) {
    out[FAMILY_OF[name] ?? "none"] += buckets[name] ?? 0;
  }
  return out;
}

/** The canonical buckets that make up one family, with their counts. */
export function familyDetail(
  buckets: Buckets,
  family: Family,
): [BucketName, number][] {
  return (Object.keys(buckets) as BucketName[])
    .filter((name) => FAMILY_OF[name] === family && buckets[name] > 0)
    .map((name) => [name, buckets[name]]);
}

const LOCALE: Record<Lang, string> = { fr: "fr-FR", en: "en-GB" };

// French groups digits and sets "%" with a narrow no-break space (U+202F), which
// the display face does not draw: "1 548" rendered as "1548". A regular no-break
// space keeps the grouping visible and the number on one line.
const spaced = (text: string) => text.replace(/\u202f/g, "\u00a0");

export function formatCount(value: number, lang: Lang): string {
  return spaced(new Intl.NumberFormat(LOCALE[lang]).format(value));
}

export function formatCompact(value: number, lang: Lang): string {
  return spaced(
    new Intl.NumberFormat(LOCALE[lang], {
      notation: value >= 10_000 ? "compact" : "standard",
      maximumFractionDigits: 1,
    }).format(value),
  );
}

export function formatShare(part: number, whole: number, lang: Lang): string {
  if (whole === 0) return "—";
  const ratio = part / whole;
  return spaced(
    new Intl.NumberFormat(LOCALE[lang], {
      style: "percent",
      maximumFractionDigits: ratio > 0 && ratio < 0.1 ? 1 : 0,
    }).format(ratio),
  );
}

export function formatRate(ratio: number | null, lang: Lang): string {
  if (ratio === null) return "—";
  return spaced(
    new Intl.NumberFormat(LOCALE[lang], {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(ratio),
  );
}

export function formatMs(value: number | null, lang: Lang): string {
  if (value === null) return "—";
  const digits = value < 10 ? 1 : 0;
  return `${spaced(new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: digits }).format(value))}\u00a0ms`;
}

/** 3 s · 4 min 12 s · 2 h 05 min — the unit a reader thinks in. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds - minutes * 60);
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds - hours * 3600) / 60);
  return `${hours} h ${String(minutes).padStart(2, "0")} min`;
}

type Unit = "s" | "min" | "h";
const unitOf = (seconds: number): Unit =>
  seconds >= 3600 ? "h" : seconds >= 60 ? "min" : "s";
const inUnit = (seconds: number, unit: Unit): number =>
  unit === "h" ? seconds / 3600 : unit === "min" ? seconds / 60 : seconds;

/** < 5 s · 5–30 s · 30 s–2 min · 2–10 min · 10 min–1 h · > 1 h */
export function formatBin(low: number, high: number | null): string {
  if (high === null) return `> ${inUnit(low, unitOf(low))} ${unitOf(low)}`;
  const upper = unitOf(high);
  if (low === 0) return `< ${inUnit(high, upper)} ${upper}`;
  const lower = unitOf(low);
  return lower === upper
    ? `${inUnit(low, lower)}–${inUnit(high, upper)} ${upper}`
    : `${inUnit(low, lower)} ${lower}–${inUnit(high, upper)} ${upper}`;
}

export function relativeTime(iso: string | null, now: Date, lang: Lang): string {
  if (!iso) return "—";
  const seconds = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(LOCALE[lang], { numeric: "auto" });
  if (seconds < 60) return rtf.format(-Math.round(seconds), "second");
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86_400) return rtf.format(-Math.round(seconds / 3600), "hour");
  return rtf.format(-Math.round(seconds / 86_400), "day");
}

/** Round ticks (0, 5, 10… / 0, 200, 400…) reaching at least `max`. */
export function niceTicks(max: number, target = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ??
    10 * power;
  const ticks: number[] = [];
  for (let value = 0; value < max + step; value += step) {
    ticks.push(Number(value.toPrecision(12)));
    if (value >= max) break;
  }
  return ticks;
}

/** Which points carry an x label, and what it says, in the reader's time zone. */
export function timeTicks(
  points: readonly { at: string }[],
  window: SupervisionWindow,
  lang: Lang,
): Map<number, string> {
  const labels = new Map<number, string>();
  const hour = new Intl.DateTimeFormat(LOCALE[lang], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const day = new Intl.DateTimeFormat(LOCALE[lang], {
    weekday: "short",
    day: "numeric",
  });
  const date = new Intl.DateTimeFormat(LOCALE[lang], {
    day: "numeric",
    month: "short",
  });
  points.forEach((point, index) => {
    const at = new Date(point.at);
    if (window === "24h" && index % 6 === 0) labels.set(index, hour.format(at));
    if (window === "7d") {
      const previous = index > 0 ? new Date(points[index - 1].at) : null;
      if (!previous || previous.getDate() !== at.getDate())
        labels.set(index, day.format(at));
    }
    if (window === "30d" && index % 5 === 0) labels.set(index, date.format(at));
  });
  return labels;
}

/** The span a point covers, for its tooltip header. */
export function pointRange(
  at: string,
  stepSeconds: number,
  window: SupervisionWindow,
  lang: Lang,
): string {
  const start = new Date(at);
  const end = new Date(start.getTime() + stepSeconds * 1000);
  const hour = new Intl.DateTimeFormat(LOCALE[lang], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const day = new Intl.DateTimeFormat(LOCALE[lang], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (window === "30d") return day.format(start);
  const span = `${hour.format(start)}–${hour.format(end)}`;
  return window === "24h" ? span : `${day.format(start)} · ${span}`;
}

/** A payload the board can draw; anything else is shown as unavailable. */
export function isSupervision(value: unknown): value is Supervision {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const payload = value as Partial<Supervision>;
  return (
    typeof payload.total === "number" &&
    typeof payload.buckets === "object" &&
    payload.buckets !== null &&
    Array.isArray(payload.series) &&
    typeof payload.latency === "object" &&
    Array.isArray(payload.classes) &&
    Array.isArray(payload.tools) &&
    Array.isArray(payload.agents) &&
    typeof payload.approvals === "object" &&
    typeof payload.probes === "object"
  );
}
