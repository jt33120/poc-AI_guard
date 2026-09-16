import type { ProtectionMode, WarnMode } from "@xsom/secret-guard-cli/hook";
import type { Decision } from "@xsom/secret-guard-core";
import type { HookHealth, HostHealth } from "./hook-manager.js";
import { HEALTH_LABELS, HEALTH_REASONS } from "./dashboard.js";

// VS Code hovers keep only a sanitized HTML subset: tables, a few inline tags and
// <span style> restricted to color, background-color and border-radius, each
// written exactly as `property:value;`. Every style below follows that grammar.

export const STATUS_TOOLTIP_COMMANDS = [
  "secretGuard.setMode",
  "secretGuard.enableHook",
  "secretGuard.finishCodexSetup",
  "secretGuard.scanClipboard",
  "secretGuard.scanDocument",
  "secretGuard.connectGateway",
  "secretGuard.disconnectGateway",
  "secretGuard.showDashboard",
  "workbench.action.openSettings",
] as const;

type TooltipCommand = (typeof STATUS_TOOLTIP_COMMANDS)[number];

export type GatewayState = "online" | "retrying" | "offline";

export interface LastScan {
  readonly source: "selection" | "clipboard" | "document";
  readonly decision: Decision;
  readonly findings: number;
  readonly complete: boolean;
  readonly time: string;
}

export interface StatusTooltipInput {
  readonly health: HookHealth;
  readonly warnMode: WarnMode;
  readonly modeApplicationFailed?: boolean;
  readonly gateway?: {
    readonly state: GatewayState;
    readonly status: string;
    readonly audit?: string;
  };
  readonly lastScan?: LastScan;
}

const COLOR = {
  muted: "var(--vscode-descriptionForeground)",
  faint: "var(--vscode-disabledForeground)",
  surface: "var(--vscode-textCodeBlock-background)",
  green: "var(--vscode-charts-green)",
  yellow: "var(--vscode-charts-yellow)",
  red: "var(--vscode-charts-red)",
  blue: "var(--vscode-charts-blue)",
  purple: "var(--vscode-charts-purple)",
  onAccent: "var(--vscode-editor-background)",
  primary: "var(--vscode-button-background)",
  onPrimary: "var(--vscode-button-foreground)",
  secondary: "var(--vscode-button-secondaryBackground)",
  onSecondary: "var(--vscode-button-secondaryForeground)",
} as const;

interface ModeTier {
  readonly mode: ProtectionMode;
  readonly level: number;
  readonly short: string;
  readonly title: string;
  readonly color: string;
  readonly exposure: string;
  readonly meter: number;
  readonly description: string;
  readonly effects: ReadonlyArray<readonly [string, string]>;
}

// Ordered from least to most protective, as the selector reads left to right.
const TIERS: readonly ModeTier[] = [
  {
    mode: "observe",
    level: 1,
    short: "Avertir",
    title: "Avertir et laisser passer",
    color: COLOR.red,
    exposure: "Élevée",
    meter: 4,
    description: "Transmettre le texte original, même avec des secrets.",
    effects: [
      ["Envoi", "Le message part tel quel, secrets compris"],
      ["Signal", "Avertissement affiché, aucun nettoyage"],
    ],
  },
  {
    mode: "redact",
    level: 2,
    short: "Expurger",
    title: "Expurger",
    color: COLOR.blue,
    exposure: "Faible",
    meter: 2,
    description: "Masquer les secrets avant de partager.",
    effects: [
      ["Envoi", "Masqué puis rescanné dans @secretguard et Claude raccordé"],
      ["Ailleurs", "Envoi arrêté, copie expurgée via le presse-papiers"],
    ],
  },
  {
    mode: "block",
    level: 3,
    short: "Bloquer",
    title: "Bloquer",
    color: COLOR.green,
    exposure: "Minimale",
    meter: 1,
    description: "Arrêter les messages contenant un secret détecté.",
    effects: [
      ["Envoi", "Arrêté : secret, ambiguïté ou analyse incomplète"],
      ["Correction", "Retirez la valeur ou copiez la version expurgée"],
    ],
  },
];

const HOST_MONOGRAMS: Record<HostHealth["id"], readonly [string, string]> = {
  claude: ["CC", COLOR.blue],
  codex: ["CX", COLOR.yellow],
  windsurf: ["WS", COLOR.green],
  vscode: ["VS", COLOR.purple],
};

const SCAN_SOURCES: Record<LastScan["source"], string> = {
  clipboard: "Presse-papiers",
  document: "Document ouvert",
  selection: "Sélection",
};

const NBSP = "&nbsp;";

function escapeHtml(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .replace(
      /[&<>"'$]/gu,
      (character) => `&#${String(character.codePointAt(0))};`,
    );
}

function span(
  content: string,
  style: { color?: string; background?: string; radius?: number },
): string {
  const css = [
    style.color === undefined ? "" : `color:${style.color};`,
    style.background === undefined
      ? ""
      : `background-color:${style.background};`,
    style.radius === undefined
      ? ""
      : `border-radius:${String(style.radius)}px;`,
  ].join("");
  return `<span style="${css}">${content}</span>`;
}

function small(content: string, color: string = COLOR.muted): string {
  return `<small>${span(content, { color })}</small>`;
}

function commandHref(command: TooltipCommand, argument?: string): string {
  const query =
    argument === undefined
      ? ""
      : `?${encodeURIComponent(JSON.stringify([argument]))}`;
  return `command:${command}${query}`;
}

function link(
  content: string,
  command: TooltipCommand,
  options: { argument?: string; title?: string } = {},
): string {
  const title =
    options.title === undefined ? "" : ` title="${escapeHtml(options.title)}"`;
  return `<a href="${commandHref(command, options.argument)}"${title}>${content}</a>`;
}

function button(
  label: string,
  command: TooltipCommand,
  variant: "primary" | "secondary" | "attention",
): string {
  const style =
    variant === "primary"
      ? { color: COLOR.onPrimary, background: COLOR.primary }
      : variant === "secondary"
        ? { color: COLOR.onSecondary, background: COLOR.secondary }
        : { color: COLOR.yellow, background: COLOR.surface };
  return link(
    span(`${NBSP}${NBSP}${label}${NBSP}${NBSP}`, { ...style, radius: 4 }),
    command,
  );
}

function pill(label: string, color: string): string {
  return span(`${NBSP}${label}${NBSP}`, {
    color,
    background: COLOR.surface,
    radius: 9,
  });
}

function row(left: string, right = ""): string {
  return `<table width="100%"><tr><td>${left}</td><td align="right">${right}</td></tr></table>`;
}

function sectionHeading(index: string, title: string, aside = ""): string {
  return row(
    `${small(`<b>${index}</b>`, COLOR.blue)}${NBSP}${NBSP}${small(`<b>${title}</b>`)}`,
    aside === "" ? "" : small(aside),
  );
}

function header(
  health: HookHealth,
  modeApplicationFailed: boolean,
): readonly string[] {
  const ready = health.state === "active" && !modeApplicationFailed;
  const label = modeApplicationFailed
    ? "Mode à appliquer"
    : HEALTH_LABELS[health.state];
  const tone = ready
    ? COLOR.green
    : health.state === "off"
      ? COLOR.muted
      : COLOR.yellow;
  const lines = [
    row(
      `${span("$(shield)", { color: COLOR.blue })}${NBSP}${small("<b>XSOM</b>")} ${span("/", { color: COLOR.faint })} <b>Secret Guard</b>${NBSP}${NBSP}${pill(`● ${label}`, tone)}`,
      link("$(settings-gear)", "workbench.action.openSettings", {
        argument: "@ext:xsom.xsom-secret-guard-vscode",
        title: "Réglages",
      }),
    ),
  ];
  if (!ready) {
    const reason = modeApplicationFailed
      ? "Le mode n’a pas pu être appliqué aux assistants."
      : HEALTH_REASONS[health.reason];
    lines.push(
      row(
        `${span("$(warning)", { color: tone })} ${small(reason, COLOR.yellow)}`,
        button(
          modeApplicationFailed ? "Réessayer" : "Configurer",
          "secretGuard.enableHook",
          "primary",
        ),
      ),
    );
  }
  return lines;
}

function tierSelector(active: ModeTier | undefined): string {
  const cells = TIERS.map((tier) => {
    if (tier === active) {
      const badge = span(`${NBSP}<b>${String(tier.level)}</b>${NBSP}`, {
        color: COLOR.onAccent,
        background: tier.color,
        radius: 9,
      });
      return `<td align="center">${span(`${NBSP}${NBSP}${badge} <b>${tier.short}</b>${NBSP}${NBSP}`, { background: COLOR.surface, radius: 5 })}</td>`;
    }
    const badge = span(`${NBSP}${String(tier.level)}${NBSP}`, {
      color: COLOR.muted,
      background: COLOR.surface,
      radius: 9,
    });
    return `<td align="center">${link(`${badge} ${tier.short}`, "secretGuard.setMode", { argument: tier.mode, title: `${tier.title} — ${tier.description}` })}</td>`;
  });
  return `<table width="100%"><tr>${cells.join("")}</tr></table>`;
}

function exposureMeter(tier: ModeTier): string {
  const bar = NBSP.repeat(7);
  const segments = [0, 1, 2, 3]
    .map(
      (index) =>
        `<small><small>${span(bar, {
          background: index < tier.meter ? tier.color : COLOR.surface,
          radius: 3,
        })}</small></small>`,
    )
    .join(NBSP);
  return `${small("Exposition")}${NBSP}${NBSP}${segments}${NBSP}${NBSP}<small><b>${span(tier.exposure, { color: tier.color })}</b></small>`;
}

function modeSection(warnMode: WarnMode): readonly string[] {
  const active = TIERS.find((tier) => tier.mode === warnMode);
  const lines = [
    sectionHeading("01", "NIVEAU DE PROTECTION", "nouvelles sessions"),
    tierSelector(active),
  ];
  if (active === undefined) {
    lines.push(
      `${span("$(warning)", { color: COLOR.yellow })} <b>Ancien réglage permissif</b><br>${small("Les détections ambiguës peuvent être transmises. Choisissez un niveau ci-dessus.")}`,
    );
  } else {
    const effects = active.effects
      .map(
        ([name, effect]) =>
          `<tr><td>${small(`<b>${name.toUpperCase()}</b>`, COLOR.faint)}</td><td>${small(effect)}</td></tr>`,
      )
      .join("");
    lines.push(
      row(
        `${span("●", { color: active.color })} <b>${active.title}</b>`,
        exposureMeter(active),
      ),
      small(active.description),
      `<table>${effects}</table>`,
    );
  }
  return lines;
}

function hostRow(
  host: HostHealth,
  health: HookHealth,
  modeTitle: string | undefined,
): string {
  const [monogram, tint] = HOST_MONOGRAMS[host.id];
  const healthy =
    host.configured &&
    (health.state === "active" || health.state === "partial");
  const status = !host.configured
    ? small("Non configuré", COLOR.yellow)
    : !healthy
      ? small("À vérifier", COLOR.yellow)
      : host.id === "codex"
        ? small("Configuré · approbation du hook à confirmer", COLOR.muted)
        : small(
            modeTitle === undefined ? "Configuré" : `Configuré · ${modeTitle}`,
          );
  const action = !healthy
    ? button("Configurer", "secretGuard.enableHook", "attention")
    : host.id === "codex"
      ? button("Finaliser", "secretGuard.finishCodexSetup", "attention")
      : "";
  const badge = span(`${NBSP}<small><b>${monogram}</b></small>${NBSP}`, {
    color: tint,
    background: COLOR.surface,
    radius: 5,
  });
  return `<tr><td width="34">${badge}</td><td><b>${escapeHtml(host.label)}</b><br>${status}</td><td align="right">${action}</td></tr>`;
}

function hostsSection(
  health: HookHealth,
  warnMode: WarnMode,
): readonly string[] {
  const configured = health.hosts.filter((host) => host.configured).length;
  const heading = sectionHeading(
    "02",
    "ASSISTANTS COUVERTS",
    health.hosts.length === 0
      ? ""
      : `${String(configured)}/${String(health.hosts.length)} configurés`,
  );
  if (health.hosts.length === 0)
    return [
      heading,
      small("État indisponible. Survolez de nouveau pour réessayer."),
    ];
  const modeTitle = TIERS.find((tier) => tier.mode === warnMode)?.short;
  const rows = health.hosts
    .map((host) => hostRow(host, health, modeTitle))
    .join("");
  return [heading, `<table width="100%">${rows}</table>`];
}

function scanSummary(scan: LastScan): string {
  const source = SCAN_SOURCES[scan.source];
  const count = String(scan.findings);
  const [color, text] = !scan.complete
    ? [COLOR.yellow, `${source} · analyse incomplète`]
    : scan.decision === "ALLOW"
      ? [COLOR.green, `${source} · aucun secret détecté`]
      : scan.decision === "WARN"
        ? [COLOR.yellow, `${source} · ${count} détection(s) à vérifier`]
        : [COLOR.red, `${source} · ${count} secret(s) détecté(s)`];
  return row(
    `${span("●", { color })} ${small(text, COLOR.muted)}`,
    small(escapeHtml(scan.time), COLOR.faint),
  );
}

function scanSection(lastScan: LastScan | undefined): readonly string[] {
  const lines = [
    sectionHeading("03", "VÉRIFIER AVANT DE PARTAGER"),
    `<table width="100%"><tr><td align="center">${button("$(clippy) Presse-papiers", "secretGuard.scanClipboard", "secondary")}</td><td align="center">${button("$(file-text) Document ouvert", "secretGuard.scanDocument", "secondary")}</td></tr></table>`,
  ];
  if (lastScan !== undefined) lines.push(scanSummary(lastScan));
  return lines;
}

function gatewaySection(
  gateway: NonNullable<StatusTooltipInput["gateway"]>,
): readonly string[] {
  const tone =
    gateway.state === "online"
      ? COLOR.green
      : gateway.state === "retrying"
        ? COLOR.yellow
        : COLOR.muted;
  const details = [small(escapeHtml(gateway.status), tone)];
  if (gateway.audit !== undefined)
    details.push(small(escapeHtml(gateway.audit), COLOR.faint));
  const action =
    gateway.state === "offline"
      ? button("Raccorder", "secretGuard.connectGateway", "primary")
      : button("Déconnecter", "secretGuard.disconnectGateway", "secondary");
  return [
    sectionHeading("04", "PASSERELLE D’ENTREPRISE"),
    `<table width="100%"><tr><td width="24">${span("$(plug)", { color: COLOR.muted })}</td><td><b>Passerelle xSOM · Claude</b><br>${details.join("<br>")}</td><td align="right">${action}</td></tr></table>`,
  ];
}

function footer(): string {
  return row(
    `${span("$(check)", { color: COLOR.green })} ${small(`Analyse locale · Sans télémétrie · <b>xSOM</b>`)}`,
    `<small>${link("Centre de protection", "secretGuard.showDashboard")}</small>`,
  );
}

export function statusTooltipMarkdown(input: StatusTooltipInput): string {
  const gateway = input.gateway ?? { state: "offline", status: "Non connecté" };
  const sections: ReadonlyArray<readonly string[]> = [
    header(input.health, input.modeApplicationFailed ?? false),
    modeSection(input.warnMode),
    hostsSection(input.health, input.warnMode),
    scanSection(input.lastScan),
    gatewaySection(gateway),
    [footer()],
  ];
  return sections
    .map((lines) => `<div>${lines.join("")}</div>`)
    .join("\n\n<hr>\n\n");
}
