import type { ProtectionMode } from "@xsom/secret-guard-cli/hook";
import type { Decision } from "@xsom/secret-guard-core";
import type { HookHealth } from "./hook-manager.js";
import { HEALTH_LABELS, HEALTH_REASONS } from "./dashboard.js";
import { modeShortLabel } from "./protection-mode.js";
import {
  alertCard,
  banner,
  footer,
  levelTile,
  sectionHeader,
  stateCard,
  wideButton,
  type Appearance,
  type Art,
  type Icon,
  type LevelState,
  type Tone,
} from "./tooltip-art.js";

export type { Appearance } from "./tooltip-art.js";

export const PURGE_CLIPBOARD_COMMAND = "secretGuard.purgeClipboard";
export const CHECK_CLIPBOARD_COMMAND = "secretGuard.checkClipboard";

// Hovering always shows the controls; a click acts on the clipboard the
// developer is about to paste. Expurger cleans it in place, the other modes
// check it and offer the cleaning.
export function statusBarClickCommand(mode: ProtectionMode): string {
  return mode === "redact" ? PURGE_CLIPBOARD_COMMAND : CHECK_CLIPBOARD_COMMAND;
}

// VS Code hovers keep only a sanitized HTML subset: tables, a few inline tags,
// <img> with data: sources and <span style> restricted to color,
// background-color and border-radius, each written exactly as `property:value;`.
// Every click target is one image from tooltip-art; HTML carries only the
// dynamic lines. Image rows and 19px text lines stack with no other spacing.

export const STATUS_TOOLTIP_COMMANDS = [
  "secretGuard.setMode",
  "secretGuard.enableHook",
  PURGE_CLIPBOARD_COMMAND,
  CHECK_CLIPBOARD_COMMAND,
  "secretGuard.showDashboard",
] as const;

type TooltipCommand = (typeof STATUS_TOOLTIP_COMMANDS)[number];

export interface LastScan {
  readonly source: "selection" | "clipboard" | "document";
  readonly decision: Decision;
  readonly findings: number;
  readonly complete: boolean;
  readonly purged?: boolean;
  readonly time: string;
}

export interface StatusTooltipInput {
  readonly appearance: Appearance;
  readonly health: HookHealth;
  readonly mode: ProtectionMode;
  // End of the running Avertir window, already formatted for display.
  readonly observeUntil?: string;
  readonly modeApplicationFailed?: boolean;
  readonly lastScan?: LastScan;
}

const COLOR = {
  dim: "var(--vscode-descriptionForeground)",
} as const;

const TONE_COLORS: Record<Tone, string> = {
  ok: "var(--vscode-charts-green)",
  info: "var(--vscode-charts-blue)",
  warn: "var(--vscode-charts-yellow)",
  danger: "var(--vscode-charts-red)",
};

interface ModeTier extends LevelState {
  readonly mode: ProtectionMode;
  readonly title: string;
}

// Ordered from least to most protective, as the tiles read left to right.
// Card strings are sized for one SVG line each (description ≤ 48 characters,
// effects ≤ 44).
const TIERS: readonly ModeTier[] = [
  {
    mode: "observe",
    label: modeShortLabel("observe"),
    title: "Avertir et laisser passer",
    tone: "warn",
    exposure: "Élevée",
    exposed: 3,
    description: "Transmet le texte original après avertissement.",
    effects: [
      ["Envoi", "Tel quel, secrets compris"],
      ["Durée", "1 heure, puis retour à Expurger"],
    ],
  },
  {
    mode: "redact",
    label: modeShortLabel("redact"),
    title: "Expurger",
    tone: "info",
    exposure: "Faible",
    exposed: 2,
    description: "Masque les secrets avant de partager.",
    effects: [
      ["Envoi", "Masqué dans @secretguard et Claude raccordé"],
      ["Ailleurs", "Arrêté · un clic expurge le presse-papiers"],
    ],
  },
  {
    mode: "block",
    label: modeShortLabel("block"),
    title: "Bloquer",
    tone: "ok",
    exposure: "Minimale",
    exposed: 1,
    description: "Arrête tout message contenant un secret.",
    effects: [
      ["Envoi", "Arrêté : secret, ambiguïté, scan incomplet"],
      ["Corriger", "Retirez ou expurgez la valeur"],
    ],
  },
];

const SCAN_SOURCES: Record<LastScan["source"], string> = {
  clipboard: "Presse-papiers",
  document: "Document ouvert",
  selection: "Sélection",
};

const HELP = {
  levels:
    "S’applique aux nouvelles sessions des assistants configurés sur ce poste.",
  purge:
    "Remplace le presse-papiers par sa version expurgée, prête à coller. Rien n’est modifié si le nettoyage n’est pas complet.",
  check:
    "Vérifie localement le presse-papiers et propose de l’expurger si un secret s’y trouve.",
  clipboardShortcut:
    "Raccourci : un clic sur Secret Guard dans la barre d’état.",
} as const;

interface Target {
  readonly command: TooltipCommand;
  readonly argument?: string;
}

interface Action extends Target {
  readonly label: string;
  readonly glyph: Icon;
}

interface Readiness {
  readonly tone: Tone;
  readonly summary: string;
  readonly alert?: {
    readonly title: string;
    readonly reason: string;
    readonly action: Action;
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .replace(
      /[&<>"'$]/gu,
      (character) => `&#${String(character.codePointAt(0))};`,
    );
}

function span(content: string, color: string): string {
  return `<span style="color:${color};">${content}</span>`;
}

function textLine(content: string): string {
  return `<div>${content}</div>`;
}

function smallLine(content: string, color: string): string {
  return textLine(`<small>${span(content, color)}</small>`);
}

function image(art: Art, alt: string, title?: string): string {
  const source = Buffer.from(art.svg, "utf8").toString("base64");
  const hint = title === undefined ? "" : ` title="${escapeHtml(title)}"`;
  return `<img src="data:image/svg+xml;base64,${source}" width="${String(art.width)}" height="${String(art.height)}" alt="${escapeHtml(alt)}"${hint}>`;
}

function link(content: string, target: Target, title?: string): string {
  const query =
    target.argument === undefined
      ? ""
      : `?${encodeURIComponent(JSON.stringify([target.argument]))}`;
  const hint = title === undefined ? "" : ` title="${escapeHtml(title)}"`;
  return `<a href="command:${target.command}${query}"${hint}>${content}</a>`;
}

// Inline images in one block sit edge to edge; the block ends a band.
function imageRow(...images: readonly string[]): string {
  return `<div>${images.join("")}</div>`;
}

function readiness(input: StatusTooltipInput): Readiness {
  const { health } = input;
  if (input.modeApplicationFailed === true)
    return {
      tone: "warn",
      summary: "Niveau non appliqué · assistants à mettre à jour",
      alert: {
        title: "Niveau non appliqué",
        reason: "Le mode n’a pas pu être appliqué aux assistants.",
        action: {
          label: "Réessayer l’application",
          glyph: "retry",
          command: "secretGuard.enableHook",
        },
      },
    };
  if (health.state !== "active") {
    const summaries = {
      partial: "couverture partielle",
      degraded: "envoi non garanti",
      off: "prompts non analysés",
    } as const;
    return {
      tone: health.state === "degraded" ? "danger" : "warn",
      summary: `${HEALTH_LABELS[health.state]} · ${summaries[health.state]}`,
      alert: {
        title: HEALTH_LABELS[health.state],
        reason: HEALTH_REASONS[health.reason],
        action: {
          label: "Configurer la protection",
          glyph: "gear",
          command: "secretGuard.enableHook",
        },
      },
    };
  }
  return {
    tone: "ok",
    summary: `${HEALTH_LABELS.active} · détection locale`,
  };
}

function headerBlocks(
  appearance: Appearance,
  state: Readiness,
): readonly string[] {
  return [
    imageRow(
      link(
        image(banner(appearance), "xSOM Secret Guard"),
        { command: "secretGuard.showDashboard" },
        "Ouvrir le centre de protection",
      ),
    ),
    textLine(
      `${span("●", TONE_COLORS[state.tone])}&nbsp;&nbsp;${span(state.summary, COLOR.dim)}`,
    ),
  ];
}

function levelBlocks(
  appearance: Appearance,
  input: StatusTooltipInput,
  state: Readiness,
): readonly string[] {
  const active = TIERS.find((tier) => tier.mode === input.mode);
  const tiles = TIERS.map((tier, rank) => {
    const selected = tier === active;
    const art = levelTile(appearance, { ...tier, rank }, selected);
    if (selected) return image(art, `Niveau ${tier.label} (actif)`);
    return link(
      image(art, `Niveau ${tier.label}`),
      { command: "secretGuard.setMode", argument: tier.mode },
      `${tier.title} — ${tier.description}`,
    );
  });
  const blocks = [
    imageRow(
      image(
        sectionHeader(
          appearance,
          "01",
          "NIVEAU DE PROTECTION",
          "nouvelles sessions",
        ),
        "Niveau de protection",
        HELP.levels,
      ),
    ),
    imageRow(...tiles),
  ];
  if (state.alert !== undefined) {
    const { title, reason, action } = state.alert;
    return [
      ...blocks,
      imageRow(
        image(
          alertCard(appearance, title, reason, state.tone),
          `${title}. ${reason}`,
        ),
      ),
      imageRow(
        link(
          image(
            wideButton(appearance, action.label, action.glyph, "primary"),
            action.label,
          ),
          action,
        ),
      ),
    ];
  }
  if (active === undefined) return blocks;
  const window =
    active.mode === "observe" && input.observeUntil !== undefined
      ? [
          smallLine(
            `Avertir jusqu’à ${escapeHtml(input.observeUntil)}, puis retour automatique à Expurger.`,
            TONE_COLORS.warn,
          ),
        ]
      : [];
  const effects = active.effects
    .map(([name, value]) => `${name} : ${value}`)
    .join(". ");
  return [
    ...blocks,
    imageRow(
      image(
        stateCard(appearance, active),
        `${active.title}. ${active.description} Exposition ${active.exposure}. ${effects}.`,
      ),
    ),
    ...window,
  ];
}

function scanLine(scan: LastScan): string {
  const source = SCAN_SOURCES[scan.source];
  const count = String(scan.findings);
  const [tone, summary]: readonly [Tone, string] = !scan.complete
    ? ["warn", `${source} · analyse incomplète`]
    : scan.purged === true
      ? ["ok", `${source} · ${count} secret(s) masqué(s)`]
      : scan.decision === "ALLOW"
        ? ["ok", `${source} · aucun secret`]
        : scan.decision === "WARN"
          ? ["warn", `${source} · ${count} détection(s) à vérifier`]
          : ["danger", `${source} · ${count} secret(s) détecté(s)`];
  return textLine(
    `<small>${span("●", TONE_COLORS[tone])}&nbsp;${span(`${summary} · ${escapeHtml(scan.time)}`, COLOR.dim)}</small>`,
  );
}

// The same action as a click on the status bar item, for discoverability.
function clipboardBlocks(
  appearance: Appearance,
  mode: ProtectionMode,
): readonly string[] {
  const [label, command, help, variant] =
    mode === "redact"
      ? ([
          "Expurger le presse-papiers",
          PURGE_CLIPBOARD_COMMAND,
          HELP.purge,
          "primary",
        ] as const)
      : ([
          "Vérifier le presse-papiers",
          CHECK_CLIPBOARD_COMMAND,
          HELP.check,
          "secondary",
        ] as const);
  return [
    imageRow(
      link(
        image(wideButton(appearance, label, "clipboard", variant), label),
        { command },
        help,
      ),
    ),
    smallLine(HELP.clipboardShortcut, COLOR.dim),
  ];
}

export function statusTooltipMarkdown(input: StatusTooltipInput): string {
  const { appearance } = input;
  const state = readiness(input);
  return [
    ...headerBlocks(appearance, state),
    ...levelBlocks(appearance, input, state),
    ...clipboardBlocks(appearance, input.mode),
    ...(input.lastScan === undefined ? [] : [scanLine(input.lastScan)]),
    imageRow(
      image(footer(appearance), "Détecteur local · Audit sans contenu · xSOM"),
    ),
  ].join("\n");
}
