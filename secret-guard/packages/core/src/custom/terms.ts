// Confidential terms of the xSOM rules pack (contract RULES-PACK.md §4).
// The pack carries only salted SHA-256 digests of normalized n-grams; the
// workstation hashes the n-grams of the text and compares.

import { Sha256, digestHex } from "../sha256.js";
import { HASH_BLOCK_COST, type WorkMeter } from "./work.js";

/** A word of the text: a maximal run of Unicode letters, numbers and marks. */
export interface Word {
  /** UTF-16 offsets in the original text, end exclusive. */
  readonly start: number;
  readonly end: number;
  /** UTF-8 bytes of the normalized word. */
  readonly bytes: Uint8Array;
  /** Same id for the same normalized word within one text. */
  readonly id: number;
}

interface NormalizedWord {
  readonly bytes: Uint8Array;
  readonly id: number;
}

const WORD_PATTERN = /[\p{L}\p{N}\p{M}]+/gu;
const MARKS = /\p{M}/gu;
const ASCII_ONLY = /^[ -~\t\n\r]*$/;
const encoder = new TextEncoder();

/** NFKD, marks removed, default Unicode lowercase. */
export function normalizeWord(word: string): string {
  if (ASCII_ONLY.test(word)) return word.toLowerCase();
  return word.normalize("NFKD").replace(MARKS, "").toLowerCase();
}

/** Normalized form of a term typed by an operator: its words joined by one space. */
export function normalizeTerm(term: string): string {
  return [...term.matchAll(WORD_PATTERN)]
    .map((match) => normalizeWord(match[0]))
    .filter((word) => word !== "")
    .join(" ");
}

/** Words of `text`, normalized. Words that normalize to nothing are ignored. */
export function textWords(text: string, meter: WorkMeter): Word[] {
  const words: Word[] = [];
  const byRaw = new Map<string, NormalizedWord | null>();
  const byNormalized = new Map<string, NormalizedWord>();
  for (const match of text.matchAll(WORD_PATTERN)) {
    const raw = match[0];
    meter.spend(1);
    let entry = byRaw.get(raw);
    if (entry === undefined) {
      const normalized = normalizeWord(raw);
      entry = normalized === "" ? null : (byNormalized.get(normalized) ?? null);
      if (normalized !== "" && entry === null) {
        entry = { bytes: encoder.encode(normalized), id: byNormalized.size };
        byNormalized.set(normalized, entry);
      }
      byRaw.set(raw, entry);
    }
    if (entry === null) continue;
    const start = match.index;
    words.push({ start, end: start + raw.length, ...entry });
  }
  return words;
}

/** Hex digest of `salt ‖ UTF-8(normalized)`, as the platform computes it. */
export function termDigest(salt: Uint8Array, normalized: string): string {
  const body = encoder.encode(normalized);
  const message = new Uint8Array(salt.length + body.length);
  message.set(salt, 0);
  message.set(body, salt.length);
  return digestHex(new Sha256().digest(message));
}

export function decodeBase64(value: string): Uint8Array {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = value.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("invalid_base64");
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

/** One n-gram candidate: word range [first, last] matched a digest. */
export interface TermHit {
  readonly start: number;
  readonly end: number;
  readonly digest: string;
  readonly words: number;
}

/**
 * Hash every n-gram of 1..`maxWords` consecutive words with `salt` and report
 * the ones whose digest is in `digests`. Several detectors sharing a salt are
 * served by one pass (the caller filters by detector afterwards).
 */
export function findTermHits(
  words: readonly Word[],
  salt: Uint8Array,
  maxWords: number,
  digests: ReadonlySet<string>,
  prefixes: ReadonlySet<number>,
  meter: WorkMeter,
): TermHit[] {
  const hits: TermHit[] = [];
  const sha = new Sha256();
  let buffer = new Uint8Array(salt.length + 256);
  buffer.set(salt, 0);
  // Words and word pairs repeat a lot in prompts and code: their verdicts
  // are remembered for this text (numeric keys, bounded), longer n-grams are
  // always hashed.
  const seen = new Map<number, string | null>();
  for (let first = 0; first < words.length; first += 1) {
    let length = salt.length;
    let key = -1;
    for (let count = 1; count <= maxWords; count += 1) {
      const word = words[first + count - 1];
      if (word === undefined) break;
      const memoizable = word.id < MEMO_WORDS;
      key =
        count === 1 && memoizable
          ? word.id
          : count === 2 && key >= 0 && memoizable
            ? MEMO_WORDS * (key + 1) + word.id
            : -1;
      const needed = length + (count > 1 ? 1 : 0) + word.bytes.length;
      if (needed > buffer.length) {
        const larger = new Uint8Array(needed * 2);
        larger.set(buffer.subarray(0, length), 0);
        buffer = larger;
      }
      if (count > 1) {
        buffer[length] = 0x20;
        length += 1;
      }
      buffer.set(word.bytes, length);
      length += word.bytes.length;
      const remembered = key >= 0 ? seen.get(key) : undefined;
      let digest: string | null;
      if (remembered !== undefined) {
        meter.spend(1);
        digest = remembered;
      } else {
        meter.spend(Sha256.blocks(length) * HASH_BLOCK_COST);
        digest = matchingDigest(sha.digest(buffer, length), digests, prefixes);
        if (key >= 0 && seen.size < MEMO_ENTRIES) seen.set(key, digest);
      }
      if (digest === null) continue;
      hits.push({
        start: (words[first] as Word).start,
        end: word.end,
        digest,
        words: count,
      });
    }
  }
  return hits;
}

const MEMO_WORDS = 2 ** 21;
const MEMO_ENTRIES = 500_000;

function matchingDigest(
  state: Uint32Array,
  digests: ReadonlySet<string>,
  prefixes: ReadonlySet<number>,
): string | null {
  // Most n-grams are rejected on the first 32 bits, without hex encoding.
  if (!prefixes.has(state[0] as number)) return null;
  const digest = digestHex(state);
  return digests.has(digest) ? digest : null;
}

export function digestPrefix(digest: string): number {
  return Number.parseInt(digest.slice(0, 8), 16);
}
