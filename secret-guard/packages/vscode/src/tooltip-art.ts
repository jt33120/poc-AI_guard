// Vector pieces of the status bar tooltip. VS Code hovers strip layout CSS but
// keep <img> with data: sources, so banner, tiles, cards and buttons are drawn
// here as standalone SVG. Images cannot read theme variables: callers pick the
// palette from the active color theme kind. Surfaces stay translucent so they
// sit on any hover background; only accents are solid.

export type Appearance = "dark" | "light";
export type Tone = "ok" | "info" | "warn" | "danger";

export interface Art {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
}

interface Palette {
  readonly surface: string;
  readonly stroke: string;
  readonly hair: string;
  readonly ink: string;
  readonly body: string;
  readonly dim: string;
  readonly faint: string;
  readonly tones: Record<Tone, string>;
  readonly brand: readonly [string, string, string];
  readonly brandDim: string;
  readonly brandSub: string;
  readonly brandIcon: string;
  readonly primary: string;
  readonly primaryStroke: string;
  readonly secondary: string;
}

const PALETTES: Record<Appearance, Palette> = {
  dark: {
    surface: "rgba(255,255,255,0.05)",
    stroke: "rgba(255,255,255,0.13)",
    hair: "rgba(255,255,255,0.10)",
    ink: "#e0e0e0",
    body: "#c0c0c0",
    dim: "#9d9d9d",
    faint: "#8a8a8a",
    tones: {
      ok: "#89d185",
      info: "#4daafc",
      warn: "#e3b341",
      danger: "#f14c4c",
    },
    brand: ["#16385c", "#1d456e", "#2b3945"],
    brandDim: "#7d9cbd",
    brandSub: "#dce8f6",
    brandIcon: "#bcd6f2",
    primary: "#0078d4",
    primaryStroke: "rgba(255,255,255,0.22)",
    secondary: "rgba(255,255,255,0.08)",
  },
  light: {
    surface: "rgba(0,0,0,0.04)",
    stroke: "rgba(0,0,0,0.15)",
    hair: "rgba(0,0,0,0.11)",
    ink: "#2b2b2b",
    body: "#3b3b3b",
    dim: "#616161",
    faint: "#6f6f6f",
    tones: {
      ok: "#116329",
      info: "#005fb8",
      warn: "#8a5d00",
      danger: "#b02525",
    },
    brand: ["#1d4f80", "#265f95", "#3f5666"],
    brandDim: "#a9c3dc",
    brandSub: "#eaf2fa",
    brandIcon: "#d3e4f5",
    primary: "#005fb8",
    primaryStroke: "rgba(0,0,0,0.16)",
    secondary: "rgba(0,0,0,0.06)",
  },
};

export const TOOLTIP_WIDTH = 354;

const SANS =
  "'Segoe UI',-apple-system,BlinkMacSystemFont,system-ui,Ubuntu,sans-serif";
const MONO = "ui-monospace,Consolas,'SF Mono',Menlo,monospace";

// 24px grid, stroked.
const ICONS = {
  shield:
    '<path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z"/><path d="M9.2 12.2l2 2 3.6-3.9"/>',
  arrow: '<path d="M8 16L16.5 7.5"/><path d="M9.5 7.5h7v7"/>',
  clipboard:
    '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a1 1 0 00-1 1v13a1 1 0 001 1h12a1 1 0 001-1V6a1 1 0 00-1-1h-2"/>',
  paperclip:
    '<path d="M17.5 11.5l-6.6 6.6a3.3 3.3 0 11-4.7-4.7l7.3-7.3a2.2 2.2 0 013.1 3.1l-7.3 7.3a1.1 1.1 0 11-1.6-1.6l6-6"/>',
  chat: '<path d="M20 4H4a1 1 0 00-1 1v10a1 1 0 001 1h3v4l5-4h8a1 1 0 001-1V5a1 1 0 00-1-1z"/>',
  plug: '<path d="M9 3v6M15 3v6M7 9h10v3a5 5 0 01-5 5 5 5 0 01-5-5V9zM12 17v4"/>',
  warning:
    '<path d="M12 4l9 16H3l9-16z"/><path d="M12 10v4"/><path d="M12 17.2h.01"/>',
  retry: '<path d="M20 12a8 8 0 11-2.6-5.9"/><path d="M20 4v4h-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M4.6 7.5l1.7 1M17.7 15.5l1.7 1M4.6 16.5l1.7-1M17.7 8.5l1.7-1"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
} as const;

export type Icon = keyof typeof ICONS;

interface TextStyle {
  readonly size: number;
  readonly fill: string;
  readonly weight?: number;
  readonly tracking?: number;
  readonly anchor?: "end";
  readonly mono?: boolean;
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) => `&#${String(character.codePointAt(0))};`,
  );
}

function svg(width: number, height: number, body: string): Art {
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">${body}</svg>`,
    width,
    height,
  };
}

function text(content: string, x: number, y: number, style: TextStyle): string {
  const attributes = [
    `x="${String(x)}"`,
    `y="${String(y)}"`,
    `font-family="${style.mono === true ? MONO : SANS}"`,
    `font-size="${String(style.size)}"`,
    style.weight === undefined ? "" : `font-weight="${String(style.weight)}"`,
    style.tracking === undefined
      ? ""
      : `letter-spacing="${String(style.tracking)}"`,
    style.anchor === undefined ? "" : `text-anchor="${style.anchor}"`,
    `fill="${style.fill}"`,
  ].filter((attribute) => attribute !== "");
  return `<text ${attributes.join(" ")}>${escapeXml(content)}</text>`;
}

function icon(
  name: Icon,
  x: number,
  y: number,
  stroke: string,
  scale: number,
): string {
  return `<g transform="translate(${String(x)},${String(y)}) scale(${String(scale)})" fill="none" stroke="${stroke}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`;
}

// SVG text cannot wrap or be measured. Lines break on words under a character
// budget that leaves ~10% slack for Segoe UI, SF and Ubuntu alike.
export function wrapWords(content: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const word of content.split(/\s+/u).filter((part) => part !== "")) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= maxChars)
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

export function banner(appearance: Appearance): Art {
  const palette = PALETTES[appearance];
  const [start, middle, end] = palette.brand;
  return svg(
    TOOLTIP_WIDTH,
    36,
    [
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${start}"/><stop offset="0.45" stop-color="${middle}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs>`,
      `<rect x="0" y="0" width="${String(TOOLTIP_WIDTH)}" height="36" rx="5" fill="url(#g)"/>`,
      icon("shield", 12, 9, palette.brandIcon, 0.75),
      text("XSOM", 37, 23, {
        size: 13.5,
        weight: 700,
        tracking: 1.7,
        fill: "#ffffff",
      }),
      text("/", 90, 23, { size: 14, weight: 300, fill: palette.brandDim }),
      text("Secret Guard", 100, 23, {
        size: 13.5,
        weight: 500,
        fill: palette.brandSub,
      }),
      icon("arrow", 321, 6, palette.brandIcon, 0.75),
    ].join(""),
  );
}

export function sectionHeader(
  appearance: Appearance,
  index: string,
  label: string,
  caption?: string,
): Art {
  const palette = PALETTES[appearance];
  return svg(
    TOOLTIP_WIDTH,
    24,
    [
      `<line x1="0" y1="0.5" x2="${String(TOOLTIP_WIDTH)}" y2="0.5" stroke="${palette.hair}"/>`,
      text(index, 0, 18, {
        mono: true,
        size: 10,
        weight: 700,
        tracking: 0.9,
        fill: palette.tones.info,
      }),
      text(label, 20, 18, {
        size: 10.5,
        weight: 700,
        tracking: 0.9,
        fill: palette.dim,
      }),
      caption === undefined
        ? ""
        : text(caption, TOOLTIP_WIDTH, 18, {
            size: 10.5,
            anchor: "end",
            fill: palette.faint,
          }),
    ].join(""),
  );
}

export interface LevelTile {
  readonly label: string;
  readonly tone: Tone;
  // 0-based strength shown by the signal bars.
  readonly rank: number;
}

export function levelTile(
  appearance: Appearance,
  level: LevelTile,
  active: boolean,
): Art {
  const palette = PALETTES[appearance];
  const width = TOOLTIP_WIDTH / 3;
  const color = palette.tones[level.tone];
  const bar = active ? color : palette.dim;
  const signal = (index: number, x: number, y: number, h: number): string =>
    `<rect x="${String(x)}" y="${String(y)}" width="3" height="${String(h)}" rx="1" fill="${index <= level.rank ? bar : palette.stroke}"/>`;
  return svg(
    width,
    36,
    [
      `<rect x="1" y="1" width="${String(width - 2)}" height="34" rx="5" fill="${active ? color : palette.surface}" fill-opacity="${active ? "0.14" : "1"}" stroke="${active ? color : palette.stroke}" stroke-opacity="${active ? "0.55" : "1"}"/>`,
      signal(0, 12, 23, 6),
      signal(1, 17, 20, 9),
      signal(2, 22, 17, 12),
      text(level.label, 33, 23, {
        size: 11.5,
        weight: active ? 700 : 400,
        fill: active ? color : palette.dim,
      }),
    ].join(""),
  );
}

export interface LevelState {
  readonly label: string;
  readonly tone: Tone;
  readonly exposure: string;
  // Lit exposure segments, out of three.
  readonly exposed: number;
  readonly description: string;
  readonly effects: ReadonlyArray<readonly [string, string]>;
}

export function stateCard(appearance: Appearance, state: LevelState): Art {
  const palette = PALETTES[appearance];
  const color = palette.tones[state.tone];
  const segment = (index: number): string =>
    `<rect x="${String(252 + index * 14)}" y="19" width="11" height="4" rx="2" fill="${index < state.exposed ? color : palette.stroke}"/>`;
  const effects = state.effects.flatMap(([name, value], index) => [
    text(name.toUpperCase(), 16, 73 + index * 15, {
      size: 9.5,
      weight: 700,
      tracking: 0.7,
      fill: palette.faint,
    }),
    text(value, 78, 73 + index * 15, { size: 10.5, fill: palette.body }),
  ]);
  return svg(
    TOOLTIP_WIDTH,
    96,
    [
      `<rect x="0.5" y="2.5" width="353" height="92" rx="5" fill="${palette.surface}" stroke="${palette.stroke}"/>`,
      `<circle cx="16" cy="22" r="4" fill="${color}"/>`,
      text(state.label, 28, 26, { size: 13, weight: 700, fill: palette.ink }),
      text("EXPOSITION", 244, 26, {
        size: 9.5,
        weight: 700,
        tracking: 0.7,
        anchor: "end",
        fill: palette.faint,
      }),
      segment(0),
      segment(1),
      segment(2),
      text(state.exposure, 340, 26, {
        size: 10,
        weight: 700,
        anchor: "end",
        fill: color,
      }),
      text(state.description, 16, 48, { size: 11.5, fill: palette.body }),
      `<line x1="16" y1="59.5" x2="338" y2="59.5" stroke="${palette.hair}"/>`,
      ...effects,
    ].join(""),
  );
}

const ALERT_LINE_CHARS = 52;

export function alertCard(
  appearance: Appearance,
  title: string,
  reason: string,
  tone: Tone,
): Art {
  const palette = PALETTES[appearance];
  const color = palette.tones[tone];
  const lines = wrapWords(reason, ALERT_LINE_CHARS).slice(0, 2);
  const height = 62 + (lines.length - 1) * 15;
  return svg(
    TOOLTIP_WIDTH,
    height,
    [
      `<rect x="0.5" y="2.5" width="353" height="${String(height - 4)}" rx="5" fill="${color}" fill-opacity="0.10" stroke="${color}" stroke-opacity="0.45"/>`,
      icon("warning", 14, 14, color, 0.8),
      text(title, 41, 26, { size: 13, weight: 700, fill: palette.ink }),
      ...lines.map((line, index) =>
        text(line, 41, 45 + index * 15, { size: 11, fill: palette.body }),
      ),
    ].join(""),
  );
}

export function wideButton(
  appearance: Appearance,
  label: string,
  glyph: Icon,
  variant: "primary" | "secondary",
): Art {
  const palette = PALETTES[appearance];
  const primary = variant === "primary";
  const foreground = primary ? "#ffffff" : palette.ink;
  return svg(
    TOOLTIP_WIDTH,
    38,
    [
      `<rect x="0.5" y="4.5" width="353" height="32" rx="5" fill="${primary ? palette.primary : palette.secondary}" stroke="${primary ? palette.primaryStroke : palette.stroke}"/>`,
      icon(glyph, 14, 12, foreground, 0.72),
      text(label, 40, 25, { size: 12, weight: 700, fill: foreground }),
    ].join(""),
  );
}

export function scopeTile(
  appearance: Appearance,
  glyph: Icon,
  label: string,
  state: string,
  tone: Tone | undefined,
): Art {
  const palette = PALETTES[appearance];
  const width = TOOLTIP_WIDTH / 2;
  const color = tone === undefined ? palette.dim : palette.tones[tone];
  const frame =
    tone === undefined
      ? `stroke="${palette.stroke}" stroke-dasharray="3 3"`
      : `stroke="${color}" stroke-opacity="0.45"`;
  return svg(
    width,
    44,
    [
      `<rect x="1" y="1" width="${String(width - 2)}" height="42" rx="5" fill="${palette.surface}" ${frame}/>`,
      icon(glyph, 13, 12, color, 0.78),
      text(label, 39, 22, { size: 11.5, weight: 700, fill: palette.ink }),
      text(state, 39, 36, { size: 10, fill: color }),
    ].join(""),
  );
}

export function footer(appearance: Appearance): Art {
  const palette = PALETTES[appearance];
  return svg(
    TOOLTIP_WIDTH,
    24,
    [
      `<line x1="0" y1="0.5" x2="${String(TOOLTIP_WIDTH)}" y2="0.5" stroke="${palette.hair}"/>`,
      icon("check", 0, 4, palette.tones.ok, 0.6),
      text("Détecteur local · Audit sans contenu", 17, 18, {
        size: 10.5,
        fill: palette.faint,
      }),
      text("XSOM", TOOLTIP_WIDTH, 18, {
        size: 10.5,
        weight: 700,
        tracking: 0.8,
        anchor: "end",
        fill: palette.dim,
      }),
    ].join(""),
  );
}
