// Safe patterns of the xSOM rules pack (contract RULES-PACK.md §3).
//
// A pattern is parsed into a small tree, validated with the contract's error
// codes, compiled to an ECMAScript RegExp source (reference semantics, no `u`
// flag, `\d \w \s` expanded to explicit ASCII classes) and executed by a
// step-counted backtracking matcher. V8's own RegExp cannot be interrupted:
// a valid but pathological pattern (many bounded quantifiers in a row) could
// stall the extension host. The matcher reproduces ECMAScript leftmost-first
// backtracking exactly, and a differential test holds it to the RegExp.

import type { WorkMeter } from "./work.js";

export type PatternError =
  | "length"
  | "invalid_character"
  | "empty_alternative"
  | "too_deep"
  | "empty_class"
  | "negated_class"
  | "bad_class_char"
  | "bad_range"
  | "bad_escape"
  | "dot_not_allowed"
  | "anchor_not_allowed"
  | "group_not_allowed"
  | "unbounded_quantifier"
  | "dangling_quantifier"
  | "stacked_quantifier"
  | "bad_quantifier"
  | "unbalanced_class"
  | "unbalanced_group"
  | "bad_literal"
  | "nested_repetition"
  | "too_short"
  | "too_long"
  | "no_anchor";

const MAX_PATTERN_LENGTH = 256;
const MAX_GROUP_DEPTH = 4;
const MAX_BOUND = 64;
const MIN_MATCH_LENGTH = 3;
const MAX_MATCH_LENGTH = 256;
const MIN_ANCHOR_LENGTH = 3;

// Characters that `\` may escape literally, in and out of classes.
const ESCAPABLE = new Set("\\^$.|?*+()[]{}-/");
const DIGITS: readonly number[] = range(48, 57);
const WORD: readonly number[] = [
  ...range(65, 90),
  ...range(97, 122),
  ...DIGITS,
  95,
];
// ASCII only: JavaScript's native \s also accepts NBSP and Unicode spaces.
const SPACES: readonly number[] = [32, 9, 10, 13, 12, 11];

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

interface CharAtom {
  readonly kind: "char";
  /** Unfolded ASCII code units accepted by this atom. */
  readonly codes: readonly number[];
  /** Plain or escaped literal character (candidate for the anchor). */
  readonly literal: boolean;
  /** Source form for the RegExp compiler. */
  readonly source: string;
}

interface GroupAtom {
  readonly kind: "group";
  readonly alternatives: readonly (readonly Term[])[];
}

interface Term {
  readonly atom: CharAtom | GroupAtom;
  readonly min: number;
  readonly max: number;
  readonly quantified: boolean;
}

class PatternSyntaxError extends Error {
  public constructor(public readonly code: PatternError) {
    super(code);
  }
}

function fail(code: PatternError): never {
  throw new PatternSyntaxError(code);
}

function escapeLiteral(code: number): string {
  const character = String.fromCharCode(code);
  return ESCAPABLE.has(character) ? `\\${character}` : character;
}

function classSource(codes: readonly number[]): string {
  // Every class is rewritten as an explicit list of ranges of ASCII codes.
  const sorted = [...new Set(codes)].sort((left, right) => left - right);
  const parts: string[] = [];
  for (let index = 0; index < sorted.length;) {
    const start = sorted[index] as number;
    let end = start;
    while (sorted[index + 1] === end + 1) {
      index += 1;
      end += 1;
    }
    index += 1;
    const low = classCharacter(start);
    parts.push(end === start ? low : `${low}-${classCharacter(end)}`);
  }
  return `[${parts.join("")}]`;
}

function classCharacter(code: number): string {
  const controls: Record<number, string> = {
    9: "\\t",
    10: "\\n",
    11: "\\v",
    12: "\\f",
    13: "\\r",
  };
  const control = controls[code];
  if (control !== undefined) return control;
  const character = String.fromCharCode(code);
  return "\\^-[]".includes(character) ? `\\${character}` : character;
}

class Parser {
  private position = 0;
  private depth = 0;

  public constructor(private readonly source: string) {}

  public parse(): readonly (readonly Term[])[] {
    const alternatives = this.alternatives();
    // The top-level sequence only stops early on an unmatched ')'.
    if (this.position < this.source.length) fail("unbalanced_group");
    return alternatives;
  }

  private peek(offset = 0): string | undefined {
    return this.source[this.position + offset];
  }

  private alternatives(): readonly (readonly Term[])[] {
    const alternatives = [this.sequence()];
    while (this.peek() === "|") {
      this.position += 1;
      alternatives.push(this.sequence());
    }
    return alternatives;
  }

  private sequence(): readonly Term[] {
    const terms: Term[] = [];
    for (;;) {
      const next = this.peek();
      if (next === undefined || next === "|") break;
      if (next === ")") {
        if (this.depth === 0) fail("unbalanced_group");
        break;
      }
      terms.push(this.term());
    }
    if (terms.length === 0) fail("empty_alternative");
    return terms;
  }

  private term(): Term {
    const atom = this.atom();
    let min = 1;
    let max = 1;
    let quantified = false;
    const next = this.peek();
    if (next === "?") {
      this.position += 1;
      min = 0;
      quantified = true;
    } else if (next === "*" || next === "+") {
      fail("unbounded_quantifier");
    } else if (next === "{") {
      [min, max] = this.braces();
      quantified = true;
    }
    if (quantified) {
      if (atom.kind === "group" && max > 1 && repeatsOrBranches(atom))
        fail("nested_repetition");
      const after = this.peek();
      if (after === "?" || after === "*" || after === "+" || after === "{")
        fail("stacked_quantifier");
    }
    return { atom, min, max, quantified };
  }

  private atom(): CharAtom | GroupAtom {
    const character = this.peek() as string;
    switch (character) {
      case "(":
        return this.group();
      case "[":
        return this.characterClass();
      case "\\":
        return this.escape();
      case ".":
        return fail("dot_not_allowed");
      case "^":
      case "$":
        return fail("anchor_not_allowed");
      case "*":
      case "+":
        return fail("unbounded_quantifier");
      case "?":
      case "{":
        return fail("dangling_quantifier");
      case "]":
      case "}":
        return fail("bad_literal");
      default: {
        this.position += 1;
        const code = character.charCodeAt(0);
        return {
          kind: "char",
          codes: [code],
          literal: true,
          source: escapeLiteral(code),
        };
      }
    }
  }

  private group(): GroupAtom {
    if (!this.source.startsWith("(?:", this.position))
      fail("group_not_allowed");
    if (this.depth + 1 > MAX_GROUP_DEPTH) fail("too_deep");
    this.position += 3;
    this.depth += 1;
    const alternatives = this.alternatives();
    if (this.peek() !== ")") fail("unbalanced_group");
    this.position += 1;
    this.depth -= 1;
    return { kind: "group", alternatives };
  }

  private escape(): CharAtom {
    const escaped = this.peek(1);
    if (escaped === undefined) fail("bad_escape");
    this.position += 2;
    if (escaped === "d")
      return { kind: "char", codes: DIGITS, literal: false, source: "[0-9]" };
    if (escaped === "w")
      return {
        kind: "char",
        codes: WORD,
        literal: false,
        source: "[A-Za-z0-9_]",
      };
    if (escaped === "s")
      return {
        kind: "char",
        codes: SPACES,
        literal: false,
        source: "[ \\t\\n\\r\\f\\v]",
      };
    if (!ESCAPABLE.has(escaped)) fail("bad_escape");
    const code = escaped.charCodeAt(0);
    return {
      kind: "char",
      codes: [code],
      literal: true,
      source: `\\${escaped}`,
    };
  }

  private characterClass(): CharAtom {
    this.position += 1;
    if (this.peek() === "^") fail("negated_class");
    if (this.peek() === "]") fail("empty_class");
    const codes: number[] = [];
    for (;;) {
      const next = this.peek();
      if (next === undefined) fail("unbalanced_class");
      if (next === "]") {
        this.position += 1;
        break;
      }
      const lower = this.classMember();
      if (
        lower.length === 1 &&
        this.peek() === "-" &&
        this.peek(1) !== undefined &&
        this.peek(1) !== "]"
      ) {
        this.position += 1;
        const upper = this.classMember();
        if (upper.length !== 1) fail("bad_class_char");
        const low = lower[0] as number;
        const high = upper[0] as number;
        if (high < low) fail("bad_range");
        codes.push(...range(low, high));
      } else codes.push(...lower);
    }
    return {
      kind: "char",
      codes,
      literal: false,
      source: classSource(codes),
    };
  }

  /** One class member: a single character (length 1) or an ASCII class. */
  private classMember(): readonly number[] {
    const character = this.peek();
    if (character === undefined) fail("unbalanced_class");
    if (character === "\\") {
      const escaped = this.peek(1);
      if (escaped === undefined) fail("bad_escape");
      this.position += 2;
      if (escaped === "d") return DIGITS;
      if (escaped === "w") return WORD;
      if (escaped === "s") return SPACES;
      if (!ESCAPABLE.has(escaped)) fail("bad_escape");
      return [escaped.charCodeAt(0)];
    }
    if (character === "[" || character === "^" || character === "-")
      fail("bad_class_char");
    this.position += 1;
    return [character.charCodeAt(0)];
  }

  private braces(): [number, number] {
    this.position += 1;
    const min = this.number();
    if (min === undefined) fail("bad_quantifier");
    if (this.peek() === "}") {
      this.position += 1;
      if (min < 1 || min > MAX_BOUND) fail("bad_quantifier");
      return [min, min];
    }
    if (this.peek() !== ",") fail("bad_quantifier");
    this.position += 1;
    if (this.peek() === "}") fail("unbounded_quantifier");
    const max = this.number();
    if (max === undefined || this.peek() !== "}") fail("bad_quantifier");
    this.position += 1;
    if (max < 1 || max > MAX_BOUND || min > max) fail("bad_quantifier");
    return [min, max];
  }

  /** `0 | [1-9][0-9]{0,2}`; anything else is not a bound. */
  private number(): number | undefined {
    const first = this.peek();
    if (first === "0") {
      this.position += 1;
      return 0;
    }
    if (first === undefined || first < "1" || first > "9") return undefined;
    let value = 0;
    let digits = 0;
    for (;;) {
      const digit = this.peek();
      if (digit === undefined || digit < "0" || digit > "9" || digits === 3)
        break;
      value = value * 10 + digit.charCodeAt(0) - 48;
      digits += 1;
      this.position += 1;
    }
    return value;
  }
}

function repeatsOrBranches(group: GroupAtom): boolean {
  if (group.alternatives.length > 1) return true;
  return group.alternatives.some((terms) =>
    terms.some(
      (term) =>
        term.quantified ||
        (term.atom.kind === "group" && repeatsOrBranches(term.atom)),
    ),
  );
}

function sequenceLength(
  terms: readonly Term[],
  pick: (term: Term) => number,
): number {
  return terms.reduce((total, term) => total + pick(term), 0);
}

function minimumLength(alternatives: readonly (readonly Term[])[]): number {
  return Math.min(
    ...alternatives.map((terms) =>
      sequenceLength(
        terms,
        (term) =>
          term.min *
          (term.atom.kind === "char"
            ? 1
            : minimumLength(term.atom.alternatives)),
      ),
    ),
  );
}

function maximumLength(alternatives: readonly (readonly Term[])[]): number {
  return Math.max(
    ...alternatives.map((terms) =>
      sequenceLength(
        terms,
        (term) =>
          term.max *
          (term.atom.kind === "char"
            ? 1
            : maximumLength(term.atom.alternatives)),
      ),
    ),
  );
}

export interface PatternAnchor {
  /** Literal text every match contains, ASCII-lowercased when case-insensitive. */
  readonly text: string;
  /** Bounds of the distance between a match start and the anchor. */
  readonly offsetMin: number;
  readonly offsetMax: number;
}

/** Longest top-level run of unquantified literals, at least three long. */
function findAnchor(
  alternatives: readonly (readonly Term[])[],
  caseInsensitive: boolean,
): PatternAnchor | undefined {
  if (alternatives.length !== 1) return undefined;
  const terms = alternatives[0] as readonly Term[];
  let best: { start: number; length: number } | undefined;
  for (let index = 0; index < terms.length;) {
    let length = 0;
    while (true) {
      const term = terms[index + length];
      if (
        term === undefined ||
        term.quantified ||
        term.atom.kind !== "char" ||
        !term.atom.literal
      )
        break;
      length += 1;
    }
    if (length >= MIN_ANCHOR_LENGTH && (best?.length ?? 0) < length)
      best = { start: index, length };
    index += Math.max(1, length);
  }
  if (best === undefined) return undefined;
  const prefix = terms.slice(0, best.start);
  const literal = terms
    .slice(best.start, best.start + best.length)
    .map((term) =>
      String.fromCharCode((term.atom as CharAtom).codes[0] as number),
    )
    .join("");
  return {
    text: caseInsensitive ? asciiLower(literal) : literal,
    offsetMin: minimumLength([prefix]),
    offsetMax: maximumLength([prefix]),
  };
}

export function asciiLower(value: string): string {
  return value.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

export type PatternValidation =
  | { readonly ok: true; readonly pattern: SafePattern }
  | { readonly ok: false; readonly error: PatternError };

/** Validate a pattern (§3). `hasContext` states whether the detector carries a context. */
export function validatePattern(
  source: string,
  hasContext: boolean,
  caseInsensitive = false,
): PatternValidation {
  const codePoints = [...source].length;
  if (codePoints < 1 || codePoints > MAX_PATTERN_LENGTH)
    return { ok: false, error: "length" };
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code < 0x20 || code > 0x7e)
      return { ok: false, error: "invalid_character" };
  }
  let alternatives: readonly (readonly Term[])[];
  try {
    alternatives = new Parser(source).parse();
  } catch (error) {
    if (error instanceof PatternSyntaxError)
      return { ok: false, error: error.code };
    throw error;
  }
  const min = minimumLength(alternatives);
  const max = maximumLength(alternatives);
  if (min < MIN_MATCH_LENGTH) return { ok: false, error: "too_short" };
  if (max > MAX_MATCH_LENGTH) return { ok: false, error: "too_long" };
  const anchor = findAnchor(alternatives, caseInsensitive);
  if (anchor === undefined && !hasContext)
    return { ok: false, error: "no_anchor" };
  return {
    ok: true,
    pattern: new SafePattern(alternatives, caseInsensitive, anchor, max),
  };
}

// ---------------------------------------------------------------------------
// Matcher

type CharSet = Uint8Array;

interface CharNode {
  readonly kind: "char";
  readonly set: CharSet;
  readonly min: number;
  readonly max: number;
  next: MatchNode | null;
}

interface FixedNode {
  readonly kind: "fixed";
  /** One iteration: a fixed sequence of character sets. */
  readonly sets: readonly CharSet[];
  readonly min: number;
  readonly max: number;
  next: MatchNode | null;
}

interface BranchNode {
  readonly kind: "branch";
  readonly alternatives: readonly (MatchNode | null)[];
  /** 0 for `(?:…)?`, 1 otherwise. */
  readonly min: number;
  next: MatchNode | null;
}

type MatchNode = CharNode | FixedNode | BranchNode;

function charSet(codes: readonly number[], caseInsensitive: boolean): CharSet {
  const set = new Uint8Array(128);
  for (const code of codes) {
    set[code] = 1;
    if (!caseInsensitive) continue;
    // Non-`u` ECMAScript folding restricted to ASCII: a pattern made of
    // ASCII characters never matches a non-ASCII code unit.
    if (code >= 65 && code <= 90) set[code + 32] = 1;
    if (code >= 97 && code <= 122) set[code - 32] = 1;
  }
  return set;
}

function flatten(
  alternatives: readonly (readonly Term[])[],
  caseInsensitive: boolean,
): CharSet[] {
  // Only called for repeated groups, which hold one branch without quantifiers.
  const sets: CharSet[] = [];
  for (const term of alternatives[0] ?? []) {
    if (term.atom.kind === "char")
      sets.push(charSet(term.atom.codes, caseInsensitive));
    else sets.push(...flatten(term.atom.alternatives, caseInsensitive));
  }
  return sets;
}

function compileSequence(
  terms: readonly Term[],
  caseInsensitive: boolean,
): MatchNode | null {
  let head: MatchNode | null = null;
  for (let index = terms.length - 1; index >= 0; index -= 1) {
    const term = terms[index] as Term;
    let node: MatchNode;
    if (term.atom.kind === "char") {
      node = {
        kind: "char",
        set: charSet(term.atom.codes, caseInsensitive),
        min: term.min,
        max: term.max,
        next: head,
      };
    } else if (term.max > 1) {
      node = {
        kind: "fixed",
        sets: flatten(term.atom.alternatives, caseInsensitive),
        min: term.min,
        max: term.max,
        next: head,
      };
    } else {
      node = {
        kind: "branch",
        alternatives: term.atom.alternatives.map((alternative) =>
          compileSequence(alternative, caseInsensitive),
        ),
        min: term.min,
        next: head,
      };
    }
    head = node;
  }
  return head;
}

function firstSet(
  alternatives: readonly (readonly Term[])[],
  caseInsensitive: boolean,
  into: CharSet,
): boolean {
  // Adds to `into` every code unit that can start a match; returns whether
  // the alternatives can also match the empty string.
  let nullable = false;
  for (const terms of alternatives) {
    let sequenceNullable = true;
    for (const term of terms) {
      let atomNullable: boolean;
      if (term.atom.kind === "char") {
        const set = charSet(term.atom.codes, caseInsensitive);
        for (let code = 0; code < 128; code += 1)
          if (set[code] === 1) into[code] = 1;
        atomNullable = false;
      } else
        atomNullable = firstSet(term.atom.alternatives, caseInsensitive, into);
      if (!(atomNullable || term.min === 0)) {
        sequenceNullable = false;
        break;
      }
    }
    if (sequenceNullable) nullable = true;
  }
  return nullable;
}

const NO_MATCH = -1;
type Continuation = (position: number) => number;

/** A validated pattern, ready to match with a work meter. */
export class SafePattern {
  private readonly program: BranchNode;
  public readonly first: CharSet;

  public constructor(
    private readonly alternatives: readonly (readonly Term[])[],
    public readonly caseInsensitive: boolean,
    public readonly anchor: PatternAnchor | undefined,
    public readonly maxLength: number,
  ) {
    this.program = {
      kind: "branch",
      alternatives: alternatives.map((terms) =>
        compileSequence(terms, caseInsensitive),
      ),
      min: 1,
      next: null,
    };
    this.first = new Uint8Array(128);
    firstSet(alternatives, caseInsensitive, this.first);
  }

  /** ECMAScript source equivalent to this pattern (without the `u` flag). */
  public get source(): string {
    return sourceOf(this.alternatives);
  }

  public get flags(): string {
    return this.caseInsensitive ? "gi" : "g";
  }

  /** End of the leftmost-first match starting exactly at `start`, or -1. */
  public matchAt(text: string, start: number, meter: WorkMeter): number {
    if (start >= text.length) return NO_MATCH;
    const code = text.charCodeAt(start);
    meter.spend(1);
    if (code >= 128 || this.first[code] !== 1) return NO_MATCH;
    return run(this.program, text, start, (end) => end, meter);
  }
}

function sourceOf(alternatives: readonly (readonly Term[])[]): string {
  return alternatives
    .map((terms) =>
      terms
        .map((term) => {
          const atom =
            term.atom.kind === "char"
              ? term.atom.source
              : `(?:${sourceOf(term.atom.alternatives)})`;
          if (!term.quantified) return atom;
          if (term.min === 0 && term.max === 1) return `${atom}?`;
          return term.min === term.max
            ? `${atom}{${String(term.min)}}`
            : `${atom}{${String(term.min)},${String(term.max)}}`;
        })
        .join(""),
    )
    .join("|");
}

function accepts(set: CharSet, text: string, position: number): boolean {
  const code = text.charCodeAt(position);
  return code < 128 && set[code] === 1;
}

function run(
  node: MatchNode | null,
  text: string,
  position: number,
  done: Continuation,
  meter: WorkMeter,
): number {
  if (node === null) return done(position);
  meter.spend(1);
  const next = node.next;
  switch (node.kind) {
    case "char": {
      // Greedy: take as many as allowed, then give back one at a time.
      let count = 0;
      while (
        count < node.max &&
        position + count < text.length &&
        accepts(node.set, text, position + count)
      )
        count += 1;
      meter.spend(count);
      for (; count >= node.min; count -= 1) {
        const end = run(next, text, position + count, done, meter);
        if (end !== NO_MATCH) return end;
        meter.spend(1);
      }
      return NO_MATCH;
    }
    case "fixed": {
      const width = node.sets.length;
      let count = 0;
      while (count < node.max) {
        const at = position + count * width;
        if (at + width > text.length) break;
        let matched = true;
        for (let index = 0; index < width; index += 1) {
          if (!accepts(node.sets[index] as CharSet, text, at + index)) {
            matched = false;
            break;
          }
        }
        meter.spend(width);
        if (!matched) break;
        count += 1;
      }
      for (; count >= node.min; count -= 1) {
        const end = run(next, text, position + count * width, done, meter);
        if (end !== NO_MATCH) return end;
        meter.spend(1);
      }
      return NO_MATCH;
    }
    case "branch": {
      const after: Continuation = (end) => run(next, text, end, done, meter);
      // ECMAScript RepeatMatcher: an optional iteration that consumed nothing
      // fails, so the engine keeps searching inside the group before skipping.
      const iteration: Continuation =
        node.min === 0
          ? (end) => (end === position ? NO_MATCH : after(end))
          : after;
      for (const alternative of node.alternatives) {
        const end = run(alternative, text, position, iteration, meter);
        if (end !== NO_MATCH) return end;
      }
      return node.min === 0 ? after(position) : NO_MATCH;
    }
  }
}
