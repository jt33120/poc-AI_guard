// Detection semantics of the xSOM rules pack (contract RULES-PACK.md §4),
// with the literal prefilter and the work budget required by §5.

import { asciiLower, type SafePattern } from "./pattern.js";
import type { ContextSpec, DetectorSpec } from "./schema.js";
import {
  decodeBase64,
  digestPrefix,
  findTermHits,
  textWords,
  type Word,
} from "./terms.js";
import { TooManyMatches, type WorkMeter } from "./work.js";

/** Native RegExp allowed below this static bound on one attempt. */
const NATIVE_ATTEMPT_LIMIT = 4_096;
/** Interpreter steps worth one native backtracking step (measured ≥ 8). */
const NATIVE_STEP_RATIO = 8;

export interface CompiledContext {
  /** ASCII-lowercased keywords. */
  readonly keywords: readonly string[];
  /** Window in code points on each side of a match. */
  readonly window: number;
}

export interface PatternDetector {
  readonly kind: "pattern";
  readonly spec: DetectorSpec;
  readonly pattern: SafePattern;
  readonly minEntropyTenths?: number;
  readonly context?: CompiledContext;
}

export interface TermsDetector {
  readonly kind: "terms";
  readonly spec: DetectorSpec;
  readonly salt: string;
  readonly digests: ReadonlySet<string>;
  readonly maxWords: number;
  readonly context?: CompiledContext;
}

export type CompiledDetector = PatternDetector | TermsDetector;

/** Terms detectors sharing a salt are hashed in one pass. */
export interface TermGroup {
  readonly salt: Uint8Array;
  readonly maxWords: number;
  readonly digests: ReadonlySet<string>;
  readonly prefixes: ReadonlySet<number>;
  /** Indexes into the detector list. */
  readonly detectors: readonly number[];
}

/** A detection: a half-open UTF-16 range of the text, never its content. */
export interface CustomMatch {
  readonly start: number;
  readonly end: number;
}

export function compileContext(
  context: ContextSpec | undefined,
): CompiledContext | undefined {
  if (context === undefined) return undefined;
  return {
    keywords: context.keywords.map(asciiLower),
    window: context.window,
  };
}

export function termGroups(
  detectors: readonly CompiledDetector[],
): TermGroup[] {
  const bySalt = new Map<string, number[]>();
  detectors.forEach((detector, index) => {
    if (detector.kind !== "terms") return;
    const group = bySalt.get(detector.salt) ?? [];
    group.push(index);
    bySalt.set(detector.salt, group);
  });
  return [...bySalt.entries()].map(([salt, indexes]) => {
    const members = indexes.map((index) => detectors[index] as TermsDetector);
    const digests = new Set(members.flatMap((member) => [...member.digests]));
    return {
      salt: decodeBase64(salt),
      maxWords: Math.max(...members.map((member) => member.maxWords)),
      digests,
      prefixes: new Set([...digests].map(digestPrefix)),
      detectors: indexes,
    };
  });
}

/** Lazily shared per-text state for all detectors of one scan. */
export class TextView {
  private loweredText: string | undefined;
  private wordList: Word[] | undefined;
  private matches = 0;
  /** Whole-text native matches, shared by detectors with the same pattern. */
  public readonly nativeCache = new Map<string, CustomMatch[]>();

  public constructor(
    public readonly text: string,
    private readonly meter: WorkMeter,
    private readonly maxMatches = Number.POSITIVE_INFINITY,
  ) {}

  /** Count kept detections; past the limit the scan stops (fail closed). */
  public keep(count: number): void {
    this.matches += count;
    if (this.matches > this.maxMatches) throw new TooManyMatches();
  }

  /** ASCII-lowercased copy; same UTF-16 length as the text. */
  public get lowered(): string {
    if (this.loweredText === undefined) {
      this.meter.spend(Math.ceil(this.text.length / 64));
      this.loweredText = asciiLower(this.text);
    }
    return this.loweredText;
  }

  public get words(): Word[] {
    this.wordList ??= textWords(this.text, this.meter);
    return this.wordList;
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Move `count` code points left of `index`, bounded by the text. */
function backwards(text: string, index: number, count: number): number {
  let position = index;
  for (let step = 0; step < count && position > 0; step += 1) {
    position -= 1;
    if (
      position > 0 &&
      isLowSurrogate(text.charCodeAt(position)) &&
      isHighSurrogate(text.charCodeAt(position - 1))
    )
      position -= 1;
  }
  return position;
}

/** Move `count` code points right of `index`, bounded by the text. */
function forwards(text: string, index: number, count: number): number {
  let position = index;
  for (let step = 0; step < count && position < text.length; step += 1) {
    if (
      isHighSurrogate(text.charCodeAt(position)) &&
      isLowSurrogate(text.charCodeAt(position + 1))
    )
      position += 2;
    else position += 1;
  }
  return position;
}

/** A keyword entirely inside [start − window, end + window), in code points. */
function contextHolds(
  view: TextView,
  match: CustomMatch,
  context: CompiledContext,
  meter: WorkMeter,
): boolean {
  const from = backwards(view.text, match.start, context.window);
  const to = forwards(view.text, match.end, context.window);
  const around = view.lowered.slice(from, to);
  meter.spend(around.length + context.window);
  return context.keywords.some((keyword) => around.includes(keyword));
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(value: string): number {
  // Counted in first-occurrence order, summed naively, as the platform does.
  const counts = new Map<string, number>();
  for (const character of value)
    counts.set(character, (counts.get(character) ?? 0) + 1);
  const length = [...value].length;
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function anyKeyword(
  view: TextView,
  context: CompiledContext,
  meter: WorkMeter,
): boolean {
  return context.keywords.some((keyword) => {
    meter.spend(Math.ceil(view.text.length / 64));
    return view.lowered.includes(keyword);
  });
}

/**
 * Whole-text matches of a context-only pattern. When the static bound on
 * one attempt is small, V8's RegExp runs the exact same leftmost-first
 * search (the differential test holds them equal) and its bounded worst
 * case is charged to the meter up front; otherwise the interpreter scans.
 */
function wholeTextMatches(
  view: TextView,
  detector: PatternDetector,
  meter: WorkMeter,
): CustomMatch[] | undefined {
  const { pattern } = detector;
  if (pattern.attemptBound > NATIVE_ATTEMPT_LIMIT) return undefined;
  const key = `${pattern.flags}/${pattern.source}`;
  const cached = view.nativeCache.get(key);
  if (cached !== undefined) return cached;
  const charge = Math.ceil(
    (view.text.length * pattern.attemptBound) / NATIVE_STEP_RATIO,
  );
  if (charge > meter.remaining()) return undefined;
  meter.spend(charge);
  const matches = pattern.nativeMatches(view.text);
  view.nativeCache.set(key, matches);
  return matches;
}

interface Interval {
  start: number;
  end: number;
}

/** Match starts that can hold the anchor, merged and sorted. */
function anchorIntervals(
  view: TextView,
  detector: PatternDetector,
  meter: WorkMeter,
): Interval[] {
  const anchor = detector.pattern.anchor;
  if (anchor === undefined) return [];
  const haystack = detector.pattern.caseInsensitive ? view.lowered : view.text;
  meter.spend(Math.ceil(haystack.length / 64));
  const intervals: Interval[] = [];
  for (
    let found = haystack.indexOf(anchor.text);
    found >= 0;
    found = haystack.indexOf(anchor.text, found + 1)
  ) {
    meter.spend(1);
    const start = Math.max(0, found - anchor.offsetMax);
    const end = found - anchor.offsetMin;
    if (end < 0) continue;
    const last = intervals.at(-1);
    if (last !== undefined && start <= last.end + 1)
      last.end = Math.max(last.end, end);
    else intervals.push({ start, end });
  }
  return intervals;
}

/**
 * Leftmost-first, non-overlapping matches over the whole text, as
 * `String.prototype.matchAll` returns them — restricted to the start
 * positions that can hold a match, which leaves the result unchanged.
 */
function patternMatches(
  view: TextView,
  detector: PatternDetector,
  meter: WorkMeter,
): CustomMatch[] {
  const { pattern } = detector;
  let intervals: Interval[];
  if (pattern.anchor !== undefined)
    intervals = anchorIntervals(view, detector, meter);
  else if (
    detector.context !== undefined &&
    anyKeyword(view, detector.context, meter)
  ) {
    const native = wholeTextMatches(view, detector, meter);
    if (native !== undefined) return native;
    intervals = [{ start: 0, end: view.text.length - 1 }];
  } else return [];

  const matches: CustomMatch[] = [];
  let position = 0;
  for (const interval of intervals) {
    position = Math.max(position, interval.start);
    while (position <= interval.end) {
      const end = pattern.matchAt(view.text, position, meter);
      if (end < 0) {
        position += 1;
        continue;
      }
      matches.push({ start: position, end });
      position = end;
    }
  }
  return matches;
}

function keepPatternMatch(
  view: TextView,
  detector: PatternDetector,
  match: CustomMatch,
  meter: WorkMeter,
): boolean {
  if (detector.minEntropyTenths !== undefined) {
    meter.spend(match.end - match.start);
    const value = view.text.slice(match.start, match.end);
    if (shannonEntropy(value) < detector.minEntropyTenths / 10) return false;
  }
  return (
    detector.context === undefined ||
    contextHolds(view, match, detector.context, meter)
  );
}

function resolveTermCandidates(
  candidates: readonly CustomMatch[],
): CustomMatch[] {
  const ordered = [...candidates].sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start),
  );
  const kept: CustomMatch[] = [];
  for (const candidate of ordered) {
    const previous = kept.at(-1);
    if (previous !== undefined && candidate.start < previous.end) continue;
    kept.push(candidate);
  }
  return kept;
}

/**
 * Detections of every detector, in detector order. Throws WorkBudgetExceeded
 * when the scan spends more than the meter allows.
 */
export function detectAll(
  detectors: readonly CompiledDetector[],
  groups: readonly TermGroup[],
  view: TextView,
  meter: WorkMeter,
  only?: ReadonlySet<number>,
): CustomMatch[][] {
  const results: CustomMatch[][] = detectors.map(() => []);
  detectors.forEach((detector, index) => {
    if (detector.kind !== "pattern" || (only && !only.has(index))) return;
    const kept = patternMatches(view, detector, meter).filter((match) =>
      keepPatternMatch(view, detector, match, meter),
    );
    view.keep(kept.length);
    results[index] = kept;
  });

  const wanted = groups.filter(
    (group) =>
      only === undefined || group.detectors.some((index) => only.has(index)),
  );
  if (wanted.length === 0) return results;
  const words = view.words;
  for (const group of wanted) {
    const hits = findTermHits(
      words,
      group.salt,
      group.maxWords,
      group.digests,
      group.prefixes,
      meter,
    );
    for (const index of group.detectors) {
      if (only && !only.has(index)) continue;
      const detector = detectors[index] as TermsDetector;
      const candidates = hits.filter(
        (hit) =>
          hit.words <= detector.maxWords &&
          detector.digests.has(hit.digest) &&
          (detector.context === undefined ||
            contextHolds(view, hit, detector.context, meter)),
      );
      const kept = resolveTermCandidates(candidates);
      view.keep(kept.length);
      results[index] = kept;
    }
  }
  return results;
}
