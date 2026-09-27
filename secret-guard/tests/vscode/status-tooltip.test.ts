import { describe, expect, it } from "vitest";
import type { HookHealth } from "../../packages/vscode/src/hook-manager.js";
import {
  CHECK_CLIPBOARD_COMMAND,
  PURGE_CLIPBOARD_COMMAND,
  statusBarClickCommand,
  statusTooltipMarkdown,
  STATUS_TOOLTIP_COMMANDS,
  type StatusTooltipInput,
} from "../../packages/vscode/src/status-tooltip.js";
import { TOOLTIP_WIDTH } from "../../packages/vscode/src/tooltip-art.js";

const healthy: HookHealth = {
  state: "active",
  reason: "local_canaries_verified",
  hosts: [
    { id: "claude", label: "Claude Code", configured: true },
    { id: "codex", label: "Codex", configured: true },
  ],
};

// Mirrors the VS Code 1.137 markdown sanitizer: anything outside these rules is
// silently stripped from the hover, which would break the layout or a control.
const VSCODE_SPAN_STYLE =
  /^(color:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(background-color:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(border-radius:[0-9]+px;)?$/u;
const USED_TAGS = new Set(["a", "div", "img", "small", "span"]);
const VSCODE_ATTRIBUTES = new Set([
  "alt",
  "height",
  "href",
  "src",
  "style",
  "title",
  "width",
]);

interface Picture {
  readonly alt: string;
  readonly title: string | undefined;
  readonly svg: string;
  readonly width: number;
}

function render(overrides: Partial<StatusTooltipInput> = {}): string {
  return statusTooltipMarkdown({
    appearance: "dark",
    health: healthy,
    mode: "block",
    ...overrides,
  });
}

function linkedCommands(markdown: string): string[] {
  return [...markdown.matchAll(/href="command:([^"?]+)/gu)].map(
    (match) => match[1]!,
  );
}

function modeLinks(markdown: string): string[] {
  return [
    ...markdown.matchAll(/href="command:secretGuard\.setMode\?([^"]+)"/gu),
  ].map((match) => (JSON.parse(decodeURIComponent(match[1]!)) as string[])[0]!);
}

function pictures(markdown: string): Picture[] {
  return [
    ...markdown.matchAll(
      /<img src="data:image\/svg\+xml;base64,([^"]+)" width="(\d+(?:\.\d+)?)" height="[^"]+" alt="([^"]*)"(?: title="([^"]*)")?>/gu,
    ),
  ].map((match) => ({
    svg: Buffer.from(match[1]!, "base64").toString("utf8"),
    width: Number(match[2]),
    alt: match[3]!,
    title: match[4],
  }));
}

function alts(markdown: string): string[] {
  return pictures(markdown).map((picture) => picture.alt);
}

// The link wrapping the image whose alt text is given, if any.
function linkFor(markdown: string, alt: string): string | undefined {
  const escaped = alt.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `<a href="command:([^"]+)"[^>]*><img [^>]*alt="${escaped}"`,
    "u",
  ).exec(markdown)?.[1];
}

describe("status bar tooltip controls", () => {
  it("checks the clipboard on click outside Expurger", () => {
    for (const mode of ["block", "observe"] as const)
      expect(statusBarClickCommand(mode)).toBe(CHECK_CLIPBOARD_COMMAND);
    expect(STATUS_TOOLTIP_COMMANDS).toContain(CHECK_CLIPBOARD_COMMAND);
  });

  it("purges the clipboard on click in Expurger", () => {
    expect(statusBarClickCommand("redact")).toBe(PURGE_CLIPBOARD_COMMAND);
    expect(STATUS_TOOLTIP_COMMANDS).toContain(PURGE_CLIPBOARD_COMMAND);
  });

  it("puts the purge first in Expurger and names the click shortcut", () => {
    const markdown = render({ mode: "redact" });
    expect(linkFor(markdown, "Expurger le presse-papiers")).toBe(
      PURGE_CLIPBOARD_COMMAND,
    );
    expect(linkedCommands(markdown)).not.toContain("secretGuard.scanClipboard");
    expect(markdown).toContain(
      "Raccourci : un clic sur Secret Guard dans la barre d’état.",
    );
    expect(linkedCommands(render())).not.toContain(PURGE_CLIPBOARD_COMMAND);
  });

  it("opens the dashboard from the whole banner", () => {
    const markdown = render();
    expect(markdown).toMatch(
      /^<div><a href="command:secretGuard\.showDashboard" title="Ouvrir le centre de protection"><img [^>]*alt="xSOM Secret Guard">/u,
    );
    expect(markdown).toContain("Prêt à veiller · détection locale");
  });

  it("marks the active level and links the other level tiles", () => {
    const markdown = render({ mode: "observe" });
    expect(alts(markdown)).toContain("Niveau Avertir (actif)");
    expect(linkFor(markdown, "Niveau Avertir (actif)")).toBeUndefined();
    expect(modeLinks(markdown)).toEqual(["redact", "block"]);
    const card = pictures(markdown).find((picture) =>
      picture.alt.startsWith("Avertir et laisser passer."),
    );
    expect(card?.alt).toContain("Exposition Élevée");
    expect(card?.svg).toContain("Transmet le texte original");
  });

  it("shows when the Avertir window ends, and only in Avertir", () => {
    const observe = render({ mode: "observe", observeUntil: "17:42" });
    expect(observe).toContain(
      "Avertir jusqu’à 17:42, puis retour automatique à Expurger.",
    );
    const card = pictures(observe).find((picture) =>
      picture.alt.startsWith("Avertir et laisser passer."),
    );
    expect(card?.alt).toContain("Durée : 1 h, puis retour à Expurger");
    expect(render({ mode: "redact", observeUntil: "17:42" })).not.toContain(
      "Avertir jusqu’à",
    );
    expect(render()).not.toContain("réglage permissif");
  });

  it("lets the Avertir length be changed from the panel, and only in Avertir", () => {
    const durationLinks = (markdown: string): number[] =>
      [
        ...markdown.matchAll(
          /href="command:secretGuard\.setObserveDuration\?([^"]+)"/gu,
        ),
      ].map(
        (match) => (JSON.parse(decodeURIComponent(match[1]!)) as number[])[0]!,
      );
    const quarter = render({
      mode: "observe",
      observeUntil: "17:42",
      observeMinutes: 15,
    });
    expect(quarter).toContain("Durée d’Avertir :");
    expect(quarter).toContain("<strong>15 min</strong>");
    expect(durationLinks(quarter)).toEqual([60, 240, 480]);
    const card = pictures(quarter).find((picture) =>
      picture.alt.startsWith("Avertir et laisser passer."),
    );
    expect(card?.alt).toContain("Durée : 15 min, puis retour à Expurger");
    // One hour by default, as before the choice existed.
    expect(durationLinks(render({ mode: "observe" }))).toEqual([15, 240, 480]);
    for (const mode of ["redact", "block"] as const) {
      const markdown = render({ mode, observeMinutes: 240 });
      expect(durationLinks(markdown)).toEqual([]);
      expect(markdown).not.toContain("Durée d’Avertir");
    }
    expect(STATUS_TOOLTIP_COMMANDS).toContain("secretGuard.setObserveDuration");
  });

  it("offers only the Avertir lengths within the organization's cap and says so", () => {
    const durationLinks = (markdown: string): number[] =>
      [
        ...markdown.matchAll(
          /href="command:secretGuard\.setObserveDuration\?([^"]+)"/gu,
        ),
      ].map(
        (match) => (JSON.parse(decodeURIComponent(match[1]!)) as number[])[0]!,
      );
    const capped = render({
      mode: "observe",
      observeUntil: "17:42",
      observeMinutes: 60,
      observeCap: 60,
    });
    expect(capped).toContain("<strong>1 h</strong>");
    expect(durationLinks(capped)).toEqual([15]);
    expect(capped).toContain("plafonné à 1 h par votre organisation");
    expect(render({ mode: "observe", observeCap: 240 })).toContain(
      "plafonné à 4 h par votre organisation",
    );
    expect(durationLinks(render({ mode: "observe", observeCap: 240 }))).toEqual(
      [15, 240],
    );
    // Outside Avertir, the cap is stated once, and the tile stays a link.
    const blocked = render({ mode: "block", observeCap: 15 });
    expect(blocked).toContain(
      "Avertir plafonné à 15 min par votre organisation.",
    );
    expect(modeLinks(blocked)).toEqual(["observe", "redact"]);
    // No organization cap: nothing is said about one.
    expect(render({ mode: "observe" })).not.toContain("organisation");
  });

  it("shows Avertir forbidden by the organization as a tile that is not a link", () => {
    for (const mode of ["block", "redact"] as const) {
      const markdown = render({ mode, observeCap: 0 });
      expect(modeLinks(markdown)).not.toContain("observe");
      const tile = pictures(markdown).find((picture) =>
        picture.alt.startsWith("Niveau Avertir"),
      );
      expect(tile?.alt).toBe(
        "Niveau Avertir (Avertir est désactivé par votre organisation)",
      );
      expect(tile?.title).toBe("Avertir est désactivé par votre organisation.");
      expect(tile?.svg).toContain('stroke-dasharray="3 3"');
      expect(linkFor(markdown, tile!.alt)).toBeUndefined();
      expect(markdown).toContain(
        "Avertir est désactivé par votre organisation.",
      );
    }
    // Still in Avertir when the policy arrives: no length is offered.
    const observing = render({ mode: "observe", observeCap: 0 });
    expect(observing).not.toContain("setObserveDuration");
    expect(observing).toContain(
      "Avertir est désactivé par votre organisation.",
    );
  });

  it("follows the color theme kind for drawn controls", () => {
    const card = (appearance: "dark" | "light"): string =>
      pictures(render({ mode: "redact", appearance })).find((picture) =>
        picture.alt.startsWith("Expurger."),
      )!.svg;
    expect(card("dark")).toContain("#4daafc");
    expect(card("light")).toContain("#005fb8");
    expect(card("light")).not.toContain("#4daafc");
  });

  it("keeps level guidance on hover", () => {
    const titles = pictures(render()).map((picture) => picture.title);
    expect(titles).toContain(
      "S’applique aux nouvelles sessions des assistants configurés sur ce poste.",
    );
  });

  it("keeps assistant details out of the compact controls", () => {
    const markdown = render();
    expect(markdown).not.toContain("Claude Code");
    expect(markdown).not.toContain("Finaliser Codex");
    expect(alts(markdown)).toContain("Niveau de protection");
    expect(alts(markdown)).not.toContain("Périmètre surveillé");
    expect(alts(markdown)).not.toContain("Relais de protection");
    expect(linkFor(markdown, "Vérifier le presse-papiers")).toBe(
      CHECK_CLIPBOARD_COMMAND,
    );
    expect(markdown).toContain(
      "Raccourci : un clic sur Secret Guard dans la barre d’état.",
    );
  });

  it("keeps relay setup in the protection center", () => {
    const markdown = render();
    expect(alts(markdown)).not.toContain("Périmètre surveillé");
    expect(alts(markdown)).not.toContain("Relais de protection");
    expect(linkedCommands(markdown)).not.toContain(
      "secretGuard.connectGateway",
    );
    expect(linkedCommands(markdown)).not.toContain(
      "secretGuard.disconnectGateway",
    );
    expect(linkedCommands(markdown)).toContain("secretGuard.showDashboard");
  });

  it("replaces the level card with an alert and a fix when protection is not ready", () => {
    const degraded = render({
      health: { ...healthy, state: "degraded", reason: "canary_failed" },
    });
    expect(alts(degraded)).toContain(
      "Protection à vérifier. Le test local de protection n’a pas abouti.",
    );
    expect(alts(degraded)).not.toContainEqual(
      expect.stringMatching(/^Bloquer\./u),
    );
    expect(linkFor(degraded, "Configurer la protection")).toBe(
      "secretGuard.enableHook",
    );

    const failed = render({ modeApplicationFailed: true });
    expect(alts(failed)).toContain(
      "Niveau non appliqué. Le mode n’a pas pu être appliqué aux assistants.",
    );
    expect(failed).not.toContain("Prêt à veiller");
    expect(linkFor(failed, "Réessayer l’application")).toBe(
      "secretGuard.enableHook",
    );
    expect(linkedCommands(render())).not.toContain("secretGuard.enableHook");
  });

  it("summarizes the last manual scan from metadata only", () => {
    expect(
      render({
        lastScan: {
          source: "document",
          decision: "BLOCK",
          findings: 2,
          complete: true,
          time: "15:43",
        },
      }),
    ).toContain("Document ouvert · 2 secret(s) détecté(s) · 15:43");
    expect(
      render({
        lastScan: {
          source: "clipboard",
          decision: "ALLOW",
          findings: 0,
          complete: false,
          time: "15:44",
        },
      }),
    ).toContain("Presse-papiers · analyse incomplète");
    expect(
      render({
        lastScan: {
          source: "clipboard",
          decision: "BLOCK",
          findings: 2,
          complete: true,
          purged: true,
          time: "15:45",
        },
      }),
    ).toContain("Presse-papiers · 2 secret(s) masqué(s) · 15:45");
  });

  it("escapes dynamic text, keeps it out of images and only links allowlisted commands", () => {
    const injected =
      '<a href="command:secretGuard.disableHook">x</a><img src=x onerror="alert(1)"> $(bug)';
    const markdown = render({
      lastScan: {
        source: "clipboard",
        decision: "BLOCK",
        findings: 1,
        complete: true,
        time: injected,
      },
    });
    expect(markdown).not.toContain("<img src=x");
    expect(markdown).not.toContain("$(bug)");
    expect(markdown).toContain("&#60;img");
    for (const { svg } of pictures(markdown)) {
      expect(svg).not.toContain("disableHook");
      expect(svg).not.toMatch(/<script|\son[a-z]+=/iu);
    }
    expect(linkedCommands(markdown)).not.toContain("secretGuard.disableHook");
    for (const command of linkedCommands(markdown))
      expect(STATUS_TOOLTIP_COMMANDS).toContain(command);
  });

  it("only emits markup the VS Code hover sanitizer keeps", () => {
    for (const appearance of ["dark", "light"] as const) {
      const markdown = render({
        appearance,
        mode: "observe",
        health: { ...healthy, state: "partial", reason: "config_invalid" },
        lastScan: {
          source: "selection",
          decision: "WARN",
          findings: 1,
          complete: true,
          time: "09:05",
        },
      });
      for (const [, tag] of markdown.matchAll(/<\/?([a-z]+)/gu))
        expect(USED_TAGS).toContain(tag);
      for (const [, name] of markdown.matchAll(/ ([a-z-]+)="/gu))
        expect(VSCODE_ATTRIBUTES).toContain(name);
      for (const [, style] of markdown.matchAll(/style="([^"]*)"/gu))
        expect(style).toMatch(VSCODE_SPAN_STYLE);
      for (const [element] of markdown.matchAll(/<[a-z]+ [^>]*style=/gu))
        expect(element.startsWith("<span ")).toBe(true);
      for (const [, source] of markdown.matchAll(/ src="([^"]*)"/gu))
        expect(source).toMatch(
          /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/u,
        );
      for (const [, attributes] of markdown.matchAll(/<[a-z]+ ([^>]*)>/gu))
        expect(attributes).not.toContain("$(");
      expect(markdown).not.toMatch(/\n\s*\n/u);
    }
  });

  it("shows the xSOM tuning in one line under the readiness line", () => {
    const markdown = render({
      rulesPack: {
        line: "Réglage xSOM · v3 · 12 règles · jusqu’au 01/09/2027",
        tone: "ok",
        offerRequest: false,
      },
    });
    const lines = markdown.split("\n");
    expect(lines[1]).toContain("Prêt à veiller");
    expect(lines[2]).toContain(
      "Réglage xSOM · v3 · 12 règles · jusqu’au 01/09/2027",
    );
    expect(linkedCommands(markdown)).not.toContain(
      "secretGuard.requestRulesPack",
    );
    // The line is text: the image controls keep their places.
    expect(alts(markdown)).toEqual(alts(render()));
  });

  it("offers a tuning request to Local users with a discreet link", () => {
    const markdown = render({
      rulesPack: {
        line: "Aucun réglage sur mesure",
        tone: "info",
        offerRequest: true,
      },
    });
    expect(markdown).toContain("Aucun réglage sur mesure");
    expect(linkedCommands(markdown)).toContain("secretGuard.requestRulesPack");
    expect(STATUS_TOOLTIP_COMMANDS).toContain("secretGuard.requestRulesPack");
  });

  it("escapes the tuning line and keeps the sanitizer rules", () => {
    const markdown = render({
      rulesPack: {
        line: 'Réglage refusé : <img src=x onerror="alert(1)"> $(bug)',
        tone: "danger",
        offerRequest: true,
      },
    });
    expect(markdown).not.toContain("<img src=x");
    expect(markdown).not.toContain("$(bug)");
    for (const [, tag] of markdown.matchAll(/<\/?([a-z]+)/gu))
      expect(USED_TAGS).toContain(tag);
    for (const [, name] of markdown.matchAll(/ ([a-z-]+)="/gu))
      expect(VSCODE_ATTRIBUTES).toContain(name);
    for (const [, style] of markdown.matchAll(/style="([^"]*)"/gu))
      expect(style).toMatch(VSCODE_SPAN_STYLE);
  });

  it("fills every image row to the drawn width", () => {
    const markdown = render({
      mode: "redact",
      gateway: { state: "online", status: "Claude raccordé" },
    });
    for (const [, row] of markdown.matchAll(/^<div>(.*<img .*)<\/div>$/gmu)) {
      const width = pictures(row!).reduce(
        (sum, picture) => sum + picture.width,
        0,
      );
      expect(width).toBe(TOOLTIP_WIDTH);
    }
  });
});
