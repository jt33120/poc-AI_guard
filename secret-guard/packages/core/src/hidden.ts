// Hidden instructions: characters a person cannot see but a model reads.
//
// Four carriers, each a documented attack on AI coding assistants:
// - Unicode tag characters (U+E0000–U+E007F), "ASCII smuggling": every tag
//   mirrors an ASCII character, invisible on screen, read as text by models.
// - Bidirectional embeddings, overrides and isolates, "Trojan Source"
//   (CVE-2021-42574): what a reviewer sees is not what the model reads.
// - Zero-width and other invisible formatting characters, repeated: bits
//   spelled between visible letters (the "Rules File Backdoor" carrier).
// - Runs of variation selectors after one character, "emoji smuggling":
//   one selector per byte of a hidden message.
//
// Their legitimate uses stay silent: the tag sequence of a subdivision flag,
// a zero-width joiner inside an emoji, the joiners of scripts that connect
// letters, one variation selector after its base, a leading byte-order mark,
// the left-to-right and right-to-left marks. The check is a pure function of
// the text: no network, no model, the same answer every time.

import { MAX_INPUT_BYTES } from "./types.js";

export type HiddenKind =
  | "tag_characters"
  | "bidi_controls"
  | "invisible_characters"
  | "variation_selectors";

export interface HiddenFinding {
  readonly kind: HiddenKind;
  /** 1-based line of the first character of the run. */
  readonly line: number;
  /** 1-based column, in code points, of the first character of the run. */
  readonly column: number;
  /** Characters in the run. Their content is never reported. */
  readonly count: number;
}

export interface HiddenReport {
  /** False past the scan limit: the caller must not treat the text as clean. */
  readonly complete: boolean;
  /** Every flagged character, even beyond the findings kept. */
  readonly hidden: number;
  readonly findings: readonly HiddenFinding[];
}

/** Findings kept per text; the total count stays exact. */
export const MAX_HIDDEN_FINDINGS = 50;
/** Scattered invisible characters below this total are treated as noise. */
export const SCATTERED_INVISIBLE_THRESHOLD = 4;

const BLACK_FLAG = 0x1f3f4;
const CANCEL_TAG = 0xe007f;
const ZWNJ = 0x200c;
const ZWJ = 0x200d;
const BOM = 0xfeff;
const SOFT_HYPHEN = 0x00ad;

const DEFAULT_IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u;
const EMOJI =
  /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]$/u;
const LETTER_OR_MARK = /^[\p{L}\p{M}\p{N}]$/u;
const JOINING_SCRIPT =
  /^[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Thaana}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Khmer}\p{Script=Myanmar}\p{M}]$/u;

const isTag = (cp: number) => cp >= 0xe0000 && cp <= 0xe007f;
const isBidiControl = (cp: number) =>
  (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
const isVariationSelector = (cp: number) =>
  (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
// Directional marks carry no hidden payload and right-to-left text needs them.
const isDirectionalMark = (cp: number) =>
  cp === 0x200e || cp === 0x200f || cp === 0x061c;

function utf8Bytes(cp: number): number {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  return cp < 0x10000 ? 3 : 4;
}

function isEmojiContext(character: string | undefined): boolean {
  if (character === undefined) return false;
  const cp = character.codePointAt(0) ?? 0;
  return EMOJI.test(character) || cp === 0xfe0f || cp === 0x20e3;
}

/** Positions of the tags that spell a subdivision flag, such as 🏴 England. */
function flagTags(points: readonly number[]): Set<number> {
  const allowed = new Set<number>();
  for (let index = 0; index < points.length; index += 1) {
    if (points[index] !== BLACK_FLAG) continue;
    let end = index + 1;
    const isSpecTag = (cp: number | undefined) =>
      cp !== undefined && cp >= 0xe0020 && cp <= 0xe007e;
    while (end - index <= 7 && isSpecTag(points[end])) end += 1;
    if (end > index + 1 && points[end] === CANCEL_TAG)
      for (let tag = index + 1; tag <= end; tag += 1) allowed.add(tag);
  }
  return allowed;
}

/** A joiner or hyphenation hint used the way its script uses it. */
function benignInvisible(
  cp: number,
  index: number,
  characters: readonly string[],
): boolean {
  const before = characters[index - 1];
  const after = characters[index + 1];
  if (cp === BOM) return index === 0;
  if (cp === ZWJ && isEmojiContext(before) && isEmojiContext(after))
    return true;
  if (
    (cp === ZWJ || cp === ZWNJ) &&
    before !== undefined &&
    after !== undefined &&
    JOINING_SCRIPT.test(before) &&
    (JOINING_SCRIPT.test(after) || LETTER_OR_MARK.test(after))
  )
    return true;
  // Mongolian free variation selectors pick a letter form.
  if (
    cp >= 0x180b &&
    cp <= 0x180f &&
    cp !== 0x180e &&
    before !== undefined &&
    /^\p{Script=Mongolian}$/u.test(before)
  )
    return true;
  return (
    cp === SOFT_HYPHEN &&
    before !== undefined &&
    after !== undefined &&
    LETTER_OR_MARK.test(before) &&
    LETTER_OR_MARK.test(after)
  );
}

type Verdict = HiddenKind | "suspect_invisible" | null;

interface Classified {
  readonly characters: string[];
  readonly verdicts: Verdict[];
  readonly complete: boolean;
}

/** Plain ASCII cannot carry any of the four: the common case costs one pass. */
function isAscii(text: string): boolean {
  for (let index = 0; index < text.length; index += 1)
    if (text.charCodeAt(index) > 0x7f) return false;
  return true;
}

function classify(text: string): Classified {
  if (text.length <= MAX_INPUT_BYTES && isAscii(text))
    return { characters: [], verdicts: [], complete: true };
  const characters: string[] = [];
  const points: number[] = [];
  let bytes = 0;
  for (const character of text) {
    const cp = character.codePointAt(0) ?? 0;
    bytes += utf8Bytes(cp);
    if (bytes > MAX_INPUT_BYTES)
      return { characters, verdicts: [], complete: false };
    characters.push(character);
    points.push(cp);
  }
  const flags = flagTags(points);
  const verdicts: Verdict[] = characters.map((character, index) => {
    const cp = points[index] ?? 0;
    if (isTag(cp)) return flags.has(index) ? null : "tag_characters";
    if (isBidiControl(cp)) return "bidi_controls";
    if (isVariationSelector(cp)) {
      const previous = points[index - 1];
      // The first selector after a visible base is how emoji and CJK choose
      // a glyph; every further one is a byte of something else.
      return previous === undefined || isVariationSelector(previous)
        ? "variation_selectors"
        : null;
    }
    if (isDirectionalMark(cp)) return null;
    if (!DEFAULT_IGNORABLE.test(character)) return null;
    return benignInvisible(cp, index, characters) ? null : "suspect_invisible";
  });
  return { characters, verdicts, complete: true };
}

/** Scattered invisible characters count only once they are too many to be noise. */
function resolveInvisible(verdicts: Verdict[]): (HiddenKind | null)[] {
  const scattered = verdicts.filter((v) => v === "suspect_invisible").length;
  return verdicts.map((verdict, index) => {
    if (verdict !== "suspect_invisible") return verdict;
    const inRun =
      verdicts[index - 1] === "suspect_invisible" ||
      verdicts[index + 1] === "suspect_invisible";
    return inRun || scattered >= SCATTERED_INVISIBLE_THRESHOLD
      ? "invisible_characters"
      : null;
  });
}

/** The hidden carriers in `text`, by run, with line and column. */
export function findHidden(text: string): HiddenReport {
  const { characters, verdicts, complete } = classify(text);
  if (!complete) return { complete: false, hidden: 0, findings: [] };
  const kinds = resolveInvisible(verdicts);
  const findings: HiddenFinding[] = [];
  let hidden = 0;
  let line = 1;
  let column = 1;
  let runStart = -1;
  let runLine = 1;
  let runColumn = 1;
  for (let index = 0; index <= characters.length; index += 1) {
    const kind = index < characters.length ? (kinds[index] ?? null) : null;
    const runKind = runStart >= 0 ? (kinds[runStart] ?? null) : null;
    if (runKind !== null && kind !== runKind) {
      if (findings.length < MAX_HIDDEN_FINDINGS)
        findings.push({
          kind: runKind,
          line: runLine,
          column: runColumn,
          count: index - runStart,
        });
      runStart = -1;
    }
    if (index === characters.length) break;
    if (kind !== null) {
      hidden += 1;
      if (runStart < 0) {
        runStart = index;
        runLine = line;
        runColumn = column;
      }
    }
    if (characters[index] === "\n") {
      line += 1;
      column = 1;
    } else column += 1;
  }
  return { complete: true, hidden, findings };
}

export interface StrippedText {
  readonly complete: boolean;
  readonly text: string;
  readonly removed: number;
}

/** The text without the characters `findHidden` flags; legitimate uses kept. */
export function stripHidden(text: string): StrippedText {
  const { characters, verdicts, complete } = classify(text);
  if (!complete) return { complete: false, text, removed: 0 };
  // The ASCII fast path classifies nothing: there is nothing to remove.
  if (characters.length === 0) return { complete: true, text, removed: 0 };
  const kinds = resolveInvisible(verdicts);
  let removed = 0;
  const kept = characters.filter((_, index) => {
    if ((kinds[index] ?? null) === null) return true;
    removed += 1;
    return false;
  });
  return { complete: true, text: kept.join(""), removed };
}

const KIND_LABEL: Record<HiddenKind, string> = {
  tag_characters: "étiquettes Unicode · ASCII masqué",
  bidi_controls: "contrôles bidirectionnels · texte réordonné",
  invisible_characters: "caractères de largeur nulle",
  variation_selectors: "sélecteurs de variante en série",
};

/** A French label for a carrier, safe to show to a person or a model. */
export function hiddenKindLabel(kind: HiddenKind): string {
  return KIND_LABEL[kind];
}
