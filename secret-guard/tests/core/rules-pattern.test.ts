import { describe, expect, it } from "vitest";
import {
  validatePattern,
  WorkBudgetExceeded,
  WorkMeter,
  type SafePattern,
} from "@xsom/secret-guard-core";
import {
  CompiledRulesPack,
  compileDetector,
} from "../../packages/core/src/custom/pack.js";
import type { RulesPackPayload } from "../../packages/core/src/custom/schema.js";

// Deterministic PRNG (mulberry32) so failures are reproducible.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.floor(next() * items.length)] as T;
}

const ATOMS = [
  "a",
  "b",
  "A",
  "-",
  "\\d",
  "\\w",
  "\\s",
  "[ab]",
  "[a-c0-1]",
  "\\.",
  // Escapes inside classes, a range across the letter cases, punctuation.
  "[\\]\\^\\-\\\\a]",
  "[Z-a]",
  "[!-/]",
  "[\\d\\s]",
  "\\[",
  "\\^",
];
const QUANTIFIERS = [
  "",
  "",
  "",
  "?",
  "{2}",
  "{0,3}",
  "{1,2}",
  "{0,64}",
  "{64}",
];

function randomSequence(next: () => number, depth: number): string {
  const length = 1 + Math.floor(next() * 4);
  let sequence = "";
  for (let index = 0; index < length; index += 1) {
    if (depth < 3 && next() < 0.25) {
      const branches = 1 + Math.floor(next() * 3);
      const inner = Array.from({ length: branches }, () =>
        randomSequence(next, depth + 1),
      ).join("|");
      sequence += `(?:${inner})${pick(next, ["", "?", "?", "{2}", "{1,3}"])}`;
    } else sequence += pick(next, ATOMS) + pick(next, QUANTIFIERS);
  }
  return sequence;
}

function randomText(next: () => number): string {
  const alphabet = [
    "a",
    "b",
    "A",
    "B",
    "c",
    "-",
    "0",
    "1",
    " ",
    ".",
    "\t",
    "é",
    " ",
    "_",
    "😀",
    "[",
    "\\",
    "]",
    "^",
    "`",
    "Z",
    "z",
    "/",
    "!",
  ];
  const length = Math.floor(next() * 40);
  return Array.from({ length }, () => pick(next, alphabet)).join("");
}

function nativeMatches(pattern: SafePattern, text: string): [number, number][] {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags))].map(
    (match) => [match.index, match.index + match[0].length],
  );
}

function interpretedMatches(
  pattern: SafePattern,
  text: string,
): [number, number][] {
  const meter = new WorkMeter(1e9);
  const matches: [number, number][] = [];
  for (let position = 0; position < text.length;) {
    const end = pattern.matchAt(text, position, meter);
    if (end < 0) position += 1;
    else {
      matches.push([position, end]);
      position = end;
    }
  }
  return matches;
}

function packWith(
  pattern: string,
  caseInsensitive: boolean,
): CompiledRulesPack {
  const spec = {
    id: "fuzz",
    label: "Fuzz",
    category: "project",
    action: "block",
    match: { type: "pattern", pattern, caseInsensitive },
  } as const;
  const detector = compileDetector(spec);
  if (detector === undefined) throw new Error("invalid");
  return new CompiledRulesPack(
    { detectors: [spec] } as unknown as RulesPackPayload,
    [detector],
  );
}

describe("safe pattern compiler", () => {
  it("expands \\d \\w \\s into explicit ASCII classes, without the u flag", () => {
    const result = validatePattern("IDX\\d{2}\\w\\s", false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pattern.source).toBe(
      "IDX[0-9]{2}[A-Za-z0-9_][ \\t\\n\\r\\f\\v]",
    );
    expect(result.pattern.flags).toBe("g");
    expect(new RegExp(result.pattern.source).test("IDX12a ")).toBe(false);
    expect(new RegExp(result.pattern.source).test("IDX12a ")).toBe(true);
  });

  it("marks case-insensitive patterns with the i flag only", () => {
    const result = validatePattern("acme-db", false, true);
    expect(result.ok && result.pattern.flags).toBe("gi");
  });

  it("matches exactly like the compiled ECMAScript RegExp (differential fuzz)", () => {
    const next = random(0x5eed);
    let compared = 0;
    for (let round = 0; round < 4000; round += 1) {
      const source = randomSequence(next, 0);
      const caseInsensitive = next() < 0.3;
      const validation = validatePattern(source, true, caseInsensitive);
      if (!validation.ok) continue;
      for (let sample = 0; sample < 6; sample += 1) {
        const text = randomText(next);
        expect(
          interpretedMatches(validation.pattern, text),
          `${source} on ${JSON.stringify(text)}`,
        ).toEqual(nativeMatches(validation.pattern, text));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(3000);
  });

  it("keeps matchAll results when only anchor positions are tried", () => {
    const next = random(0xa11c);
    let compared = 0;
    for (let round = 0; round < 4000; round += 1) {
      const source = `${randomSequence(next, 1)}abA${randomSequence(next, 1)}`;
      const caseInsensitive = next() < 0.4;
      const validation = validatePattern(source, false, caseInsensitive);
      if (!validation.ok) continue;
      const pack = packWith(source, caseInsensitive);
      for (let sample = 0; sample < 6; sample += 1) {
        const text = `${randomText(next)}abA${randomText(next)}aBa${randomText(next)}`;
        const [matches] = pack.detect(text, new WorkMeter(1e9));
        expect(
          (matches ?? []).map((match) => [match.start, match.end]),
          `${source} on ${JSON.stringify(text)}`,
        ).toEqual(nativeMatches(validation.pattern, text));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(3000);
  });

  it("follows ECMAScript when an optional group can match empty", () => {
    const result = validatePattern("XYZ(?:a?|b)?", false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(interpretedMatches(result.pattern, "XYZb")).toEqual(
      nativeMatches(result.pattern, "XYZb"),
    );
    expect(interpretedMatches(result.pattern, "XYZb")).toEqual([[0, 4]]);
  });

  it("stops a pathological but valid pattern at the work budget", () => {
    // Twenty bounded quantifiers in a row: exponential for a backtracker.
    const source = `ACME${"[a-z]{0,8}".repeat(20)}Z`;
    const validation = validatePattern(source, false);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const text = `ACME${"a".repeat(160)}`;
    const meter = new WorkMeter(5_000_000);
    expect(() => validation.pattern.matchAt(text, 0, meter)).toThrow(
      WorkBudgetExceeded,
    );
    expect(meter.used).toBe(5_000_001);
  });
});
