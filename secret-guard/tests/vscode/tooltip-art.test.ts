import { describe, expect, it } from "vitest";
import {
  alertCard,
  banner,
  footer,
  levelTile,
  scopeTile,
  sectionHeader,
  stateCard,
  TOOLTIP_WIDTH,
  wideButton,
  wrapWords,
  type Art,
} from "../../packages/vscode/src/tooltip-art.js";

const STATE = {
  label: "Bloquer",
  tone: "ok",
  exposure: "Minimale",
  exposed: 1,
  description: "Arrête tout message contenant un secret.",
  effects: [["Envoi", "Arrêté avant l’envoi"]],
} as const;

function declaredSize(art: Art): [number, number] {
  const match = /^<svg [^>]*width="([\d.]+)" height="([\d.]+)"/u.exec(art.svg);
  return [Number(match?.[1]), Number(match?.[2])];
}

function litBars(art: Art, color: string): number {
  return [...art.svg.matchAll(/<rect [^>]*width="3" [^>]*fill="([^"]+)"/gu)]
    .map((match) => match[1])
    .filter((fill) => fill === color).length;
}

describe("status tooltip art", () => {
  it("declares the same size in the SVG and in the image metadata", () => {
    const pieces = [
      banner("dark"),
      sectionHeader("light", "01", "NIVEAU", "note"),
      levelTile("dark", { label: "Bloquer", tone: "ok", rank: 2 }, true),
      stateCard("dark", STATE),
      alertCard("light", "Titre", "Raison", "warn"),
      wideButton("dark", "Raccorder", "plug", "primary"),
      scopeTile("dark", "chat", "Prompt", "Surveillé", "ok"),
      footer("light"),
    ];
    for (const art of pieces)
      expect(declaredSize(art)).toEqual([art.width, art.height]);
  });

  it("tiles level and scope pieces to the full tooltip width", () => {
    const level = levelTile(
      "dark",
      { label: "A", tone: "warn", rank: 0 },
      false,
    );
    expect(level.width * 3).toBe(TOOLTIP_WIDTH);
    const scope = scopeTile("dark", "paperclip", "B", "C", undefined);
    expect(scope.width * 2).toBe(TOOLTIP_WIDTH);
  });

  it("lights signal bars up to the rank, in the tone only when active", () => {
    const red = "#f14c4c";
    const tile = (rank: number, active: boolean): Art =>
      levelTile("dark", { label: "L", tone: "danger", rank }, active);
    expect(litBars(tile(0, true), red)).toBe(1);
    expect(litBars(tile(2, true), red)).toBe(3);
    expect(tile(2, false).svg).not.toContain(red);
  });

  it("dashes the frame of an uncovered scope", () => {
    expect(
      scopeTile("dark", "paperclip", "P", "Hors", undefined).svg,
    ).toContain("stroke-dasharray");
    expect(scopeTile("dark", "paperclip", "P", "Oui", "ok").svg).not.toContain(
      "stroke-dasharray",
    );
  });

  it("wraps alert reasons on words and grows the card for a second line", () => {
    expect(wrapWords("un deux trois quatre", 9)).toEqual([
      "un deux",
      "trois",
      "quatre",
    ]);
    const short = alertCard("dark", "T", "Court.", "danger");
    const long = alertCard(
      "dark",
      "T",
      "Configuration et tests locaux vérifiés. Validez le blocage dans chaque assistant utilisé.",
      "danger",
    );
    expect(long.height).toBeGreaterThan(short.height);
    expect(long.svg.match(/<text /gu)?.length).toBe(3);
  });

  it("escapes text drawn inside images", () => {
    const art = sectionHeader("dark", "01", '<b onload="x">&');
    expect(art.svg).not.toContain("<b ");
    expect(art.svg).toContain("&#60;b onload=&#34;x&#34;&#62;&#38;");
  });
});
