import { decodeBase64Budgeted, type DecodeBudget } from "./encoding.js";
import {
  identityView,
  createSpanFactory,
  joinedLineView,
  jsonEscapedView,
  mapRange,
  normalizedView,
  percentDecodedView,
  sliceMappedView,
  type MappedView,
} from "./mapping.js";
import { boundedScore, decisionForLevel, levelForScore } from "./risk.js";
import {
  type InternalFinding,
  scanContextualAssignments,
  scanCredentialUrls,
  scanEntropy,
  scanFixedRules,
} from "./rules.js";
import {
  MAX_INPUT_BYTES,
  RULESET_VERSION,
  type Finding,
  type ScanInput,
  type ScanResult,
  type SanitizeResult,
  type SecretType,
} from "./types.js";

const MAX_FINDINGS = 2_048;
const BASE64_CANDIDATE = /[A-Za-z0-9+/_-]{20,16384}={0,2}/g;
const TOKEN_PREFIXES = [
  "github_pat_",
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "glpat-",
  "sk-",
  "sk_live_",
  "sk_test_",
  "rk_live_",
  "rk_test_",
  "xoxb-",
  "xoxa-",
  "xoxp-",
  "xoxr-",
  "xoxs-",
  "https://hooks.slack.com/services/",
  "AIza",
  "ya29.",
  "SG.",
  "npm_",
  "hf_",
  "dapi",
  "dop_v1_",
  "shpat_",
  "shpss_",
  "shpca_",
  "shppa_",
  "AccountKey=",
  "AKIA",
  "ASIA",
  "AGPA",
  "AIDA",
  "AROA",
  "AIPA",
  "ANPA",
  "ANVA",
  "eyJ",
] as const;
const OPTIONAL_LINE_WRAP = String.raw`(?:\r?\n[ \t]{0,4})?`;
const SPLIT_TOKEN_PREFIX = new RegExp(
  TOKEN_PREFIXES.map((prefix) =>
    [...prefix]
      .map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(OPTIONAL_LINE_WRAP),
  ).join("|"),
  "g",
);
const MAX_JOINED_WINDOWS = 128;
const MAX_JOINED_CANDIDATE_CHARACTERS = 16_384;

interface JoinedWindowBudget {
  windows: number;
}

function isBase64Character(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    character === "+" ||
    character === "/" ||
    character === "_" ||
    character === "-"
  );
}

function isFixedTokenCharacter(character: string | undefined): boolean {
  return isBase64Character(character) || character === "." || character === "=";
}

function isKnownSriCandidate(value: string): boolean {
  const match = /^sha(256|384|512)-([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (match === null) return false;
  const bodyLength = (match[2] ?? "").length;
  return {
    "256": [43, 44],
    "384": [64],
    "512": [86, 88],
  }[match[1] as "256" | "384" | "512"].includes(bodyLength);
}

function isPlausibleBase64Payload(value: string): boolean {
  if (isKnownSriCandidate(value)) return false;
  const symbols = new Set<string>();
  for (const character of value) {
    symbols.add(character);
    if (symbols.size >= 4) break;
  }
  if (symbols.size < 4 || value.length % 4 === 1) return false;
  const usesStandardSymbols = /[+/]/.test(value);
  const usesUrlSafeSymbols = /[-_]/.test(value);
  // RFC 4648 standard and URL-safe alphabets are each supported, but a hybrid
  // candidate is neither. Rejecting it also avoids treating paths as payloads.
  return !(usesStandardSymbols && usesUrlSafeSymbols);
}

function joinedWindow(
  view: MappedView,
  start: number,
  end: number,
): MappedView | null {
  return joinedLineView(sliceMappedView(view, start, end));
}

function consumeWrappedTail(
  text: string,
  initialEnd: number,
  initialCharacters: number,
): { readonly end: number; readonly characters: number } {
  let end = initialEnd;
  let characters = initialCharacters;
  let padding = 0;
  while (padding < 2 && text[end] === "=") {
    end += 1;
    padding += 1;
  }
  if (padding > 0) return { end, characters };

  while (characters < MAX_JOINED_CANDIDATE_CHARACTERS) {
    let cursor = end;
    if (text[cursor] === "\r" && text[cursor + 1] === "\n") cursor += 2;
    else if (text[cursor] === "\n") cursor += 1;
    else break;
    let indentation = 0;
    while (indentation < 4 && (text[cursor] === " " || text[cursor] === "\t")) {
      cursor += 1;
      indentation += 1;
    }
    if (!isBase64Character(text[cursor])) break;
    while (
      characters < MAX_JOINED_CANDIDATE_CHARACTERS &&
      isBase64Character(text[cursor])
    ) {
      cursor += 1;
      characters += 1;
    }
    padding = 0;
    while (padding < 2 && text[cursor] === "=") {
      cursor += 1;
      padding += 1;
    }
    end = cursor;
    if (padding > 0) break;
  }
  return { end, characters };
}

function lineWrappedBase64Views(
  view: MappedView,
  budget: JoinedWindowBudget,
): MappedView[] | null {
  if (!view.text.includes("\n")) return [];
  const windows: MappedView[] = [];
  let coveredUntil = -1;
  let newline = view.text.indexOf("\n");
  while (newline >= 0) {
    if (newline < coveredUntil) {
      newline = view.text.indexOf("\n", newline + 1);
      continue;
    }
    let left = newline - 1;
    if (view.text[left] === "\r") left -= 1;
    let leftLength = 0;
    while (
      left >= 0 &&
      leftLength < MAX_JOINED_CANDIDATE_CHARACTERS &&
      isBase64Character(view.text[left])
    ) {
      left -= 1;
      leftLength += 1;
    }

    let right = newline + 1;
    let indentation = 0;
    while (
      indentation < 4 &&
      (view.text[right] === " " || view.text[right] === "\t")
    ) {
      right += 1;
      indentation += 1;
    }
    const rightStart = right;
    const rightBudget = Math.max(
      0,
      MAX_JOINED_CANDIDATE_CHARACTERS - leftLength,
    );
    while (
      right - rightStart < rightBudget &&
      isBase64Character(view.text[right])
    )
      right += 1;
    const rightLength = right - rightStart;
    if (leftLength >= 8 && rightLength >= 8) {
      const extended = consumeWrappedTail(
        view.text,
        right,
        leftLength + rightLength,
      );
      const joined = joinedWindow(view, left + 1, extended.end);
      if (joined !== null) {
        windows.push(joined);
        budget.windows += 1;
      }
      coveredUntil = extended.end;
      if (budget.windows > MAX_JOINED_WINDOWS) return null;
    }
    newline = view.text.indexOf("\n", newline + 1);
  }
  return windows;
}

function lineWrappedFixedViews(
  view: MappedView,
  budget: JoinedWindowBudget,
): MappedView[] | null {
  if (!view.text.includes("\n")) return [];
  const windows: MappedView[] = [];
  const prefixes = new RegExp(SPLIT_TOKEN_PREFIX.source, "g");
  for (const match of view.text.matchAll(prefixes)) {
    const start = match.index ?? 0;
    const previous = view.text[start - 1];
    if (previous !== undefined && /[A-Za-z0-9_]/.test(previous)) continue;

    let end = start + match[0].length;
    let characters = match[0].replace(/[\r\n \t]/g, "").length;
    while (
      characters < MAX_JOINED_CANDIDATE_CHARACTERS &&
      isFixedTokenCharacter(view.text[end])
    ) {
      end += 1;
      characters += 1;
    }
    while (characters < MAX_JOINED_CANDIDATE_CHARACTERS) {
      let cursor = end;
      if (view.text[cursor] === "\r" && view.text[cursor + 1] === "\n")
        cursor += 2;
      else if (view.text[cursor] === "\n") cursor += 1;
      else break;
      let indentation = 0;
      while (
        indentation < 4 &&
        (view.text[cursor] === " " || view.text[cursor] === "\t")
      ) {
        cursor += 1;
        indentation += 1;
      }
      if (!isFixedTokenCharacter(view.text[cursor])) break;
      while (
        characters < MAX_JOINED_CANDIDATE_CHARACTERS &&
        isFixedTokenCharacter(view.text[cursor])
      ) {
        cursor += 1;
        characters += 1;
      }
      end = cursor;
    }
    if (!view.text.slice(start, end).includes("\n")) continue;
    const joined = joinedWindow(view, start, end);
    if (joined !== null) {
      windows.push(joined);
      budget.windows += 1;
    }
    if (budget.windows > MAX_JOINED_WINDOWS) return null;
  }
  return windows;
}

function utf8Length(
  content: string,
  stopAfter = Number.POSITIVE_INFINITY,
): number {
  let bytes = 0;
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      (content.charCodeAt(index + 1) ?? 0) >= 0xdc00 &&
      (content.charCodeAt(index + 1) ?? 0) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (bytes > stopAfter) return stopAfter + 1;
  }
  return bytes;
}

function limitFinding(
  type: "scan_limit" | "scan_error",
  reason: string,
): Finding {
  const score = 100;
  const origin = { offset: 0, line: 1, column: 1 } as const;
  return {
    ruleId: type === "scan_limit" ? "input_too_large" : "scanner_failure",
    secretType: type,
    // A global scanner failure has no trustworthy source range. A zero-width
    // origin avoids allocating line metadata for a potentially huge input.
    span: { start: origin, end: origin },
    score,
    level: levelForScore(score),
    reasons: [reason],
    encoding: "plain",
  };
}

function failedResult(
  inputBytes: number,
  type: "scan_limit" | "scan_error",
): ScanResult {
  const finding = limitFinding(
    type,
    type === "scan_limit"
      ? "maximum_input_size_exceeded"
      : "scanner_failed_closed",
  );
  return {
    decision: "BLOCK",
    level: "CRITICAL",
    score: 100,
    findings: [finding],
    complete: false,
    inputBytes,
    rulesetVersion: RULESET_VERSION,
  };
}

function appendBounded(
  target: InternalFinding[],
  additions: readonly InternalFinding[],
): boolean {
  target.push(...additions);
  return target.length <= MAX_FINDINGS;
}

function scanDetectors(
  view: MappedView,
  includeEntropy: boolean,
  budget: DecodeBudget,
  languageId?: string,
  allowStructuredDecoding = true,
): InternalFinding[] | null {
  const fixed = scanFixedRules(view, budget, allowStructuredDecoding);
  if (budget.exhausted) return null;
  const contextual = scanContextualAssignments(
    view,
    budget,
    languageId,
    allowStructuredDecoding,
  );
  if (budget.exhausted) return null;
  const findings = [...fixed, ...scanCredentialUrls(view), ...contextual];
  if (includeEntropy) findings.push(...scanEntropy(view));
  return findings;
}

function canonicalizedView(view: MappedView): MappedView {
  return normalizedView(view) ?? view;
}

/** Apply at most one percent layer and one JSON-escape layer in either order. */
function transformedTextViews(canonical: MappedView): MappedView[] {
  const transformed: MappedView[] = [];
  const percent = percentDecodedView(canonical);
  const json = jsonEscapedView(canonical);

  if (percent !== null) {
    const canonicalPercent = canonicalizedView(percent);
    transformed.push(canonicalPercent);
    const jsonAfterPercent = jsonEscapedView(canonicalPercent);
    if (jsonAfterPercent !== null)
      transformed.push(canonicalizedView(jsonAfterPercent));
  }
  if (json !== null) {
    const canonicalJson = canonicalizedView(json);
    transformed.push(canonicalJson);
    const percentAfterJson = percentDecodedView(canonicalJson);
    if (percentAfterJson !== null)
      transformed.push(canonicalizedView(percentAfterJson));
  }

  return transformed;
}

function scanDecodedText(
  decoded: string,
  decodeBudget: DecodeBudget,
  joinedWindowBudget: JoinedWindowBudget,
): InternalFinding[] | null {
  const findings: InternalFinding[] = [];
  const identity = identityView(decoded);
  const normalized = normalizedView(decoded);
  const canonical = normalized ?? identity;
  const views = [identity, ...(normalized === null ? [] : [normalized])];
  const transformed = transformedTextViews(canonical);

  for (const view of [...views, ...transformed]) {
    const detected = scanDetectors(view, false, decodeBudget, undefined, false);
    if (detected === null || !appendBounded(findings, detected)) return null;
  }

  for (const view of [canonical, ...transformed]) {
    const fixedWindows = lineWrappedFixedViews(view, joinedWindowBudget);
    if (fixedWindows === null) return null;
    for (const joined of fixedWindows) {
      const detected = scanFixedRules(joined, decodeBudget, false);
      if (!appendBounded(findings, detected)) return null;
    }
  }
  return findings;
}

function scanBase64Candidates(
  view: MappedView,
  budget: DecodeBudget,
  joinedWindowBudget: JoinedWindowBudget,
  seenCandidates: Set<string>,
): InternalFinding[] | null {
  const findings: InternalFinding[] = [];
  const pattern = new RegExp(BASE64_CANDIDATE.source, BASE64_CANDIDATE.flags);

  for (const match of view.text.matchAll(pattern)) {
    if (!isPlausibleBase64Payload(match[0])) continue;
    const viewStart = match.index ?? 0;
    const [start, end] = mapRange(view, viewStart, viewStart + match[0].length);
    const sourceRange = `${start}:${end}`;
    if (seenCandidates.has(sourceRange)) continue;
    seenCandidates.add(sourceRange);
    const decoded = decodeBase64Budgeted(match[0], 16_384, budget);
    if (budget.exhausted) return null;
    if (decoded === null) continue;
    // One Base64 layer only: provider/context detectors and bounded text
    // canonicalizers still run, but JWT/Docker validators may not trigger a
    // second Base64 decode.
    const inner = scanDecodedText(decoded, budget, joinedWindowBudget);
    if (inner === null) return null;
    if (inner.length === 0) continue;

    for (const finding of inner) {
      findings.push({
        ruleId: finding.ruleId,
        secretType: finding.secretType,
        start,
        end,
        score: boundedScore(finding.score - 5),
        reasons: [...finding.reasons, "single_level_base64_decode"],
        encoding: "base64",
      });
    }
  }
  return findings;
}

function overlaps(left: InternalFinding, right: InternalFinding): boolean {
  return left.start < right.end && right.start < left.end;
}

function encodingRank(encoding: InternalFinding["encoding"]): number {
  return {
    plain: 0,
    normalized: 1,
    percent: 2,
    "json-escaped": 3,
    "whitespace-joined": 4,
    base64: 5,
  }[encoding];
}

function specificityRank(finding: InternalFinding): number {
  if (finding.ruleId === "high_entropy") return 2;
  if (finding.ruleId.startsWith("contextual_")) return 1;
  return 0;
}

/** Keep the strongest explanation for one source span while preserving distinct adjacent findings. */
function dedupeOverlaps(
  findings: readonly InternalFinding[],
): InternalFinding[] {
  const strongestFirst = [...findings].sort(
    (left, right) =>
      specificityRank(left) - specificityRank(right) ||
      right.score - left.score ||
      right.end - right.start - (left.end - left.start) ||
      encodingRank(left.encoding) - encodingRank(right.encoding) ||
      left.ruleId.localeCompare(right.ruleId),
  );
  const kept: InternalFinding[] = [];
  for (const finding of strongestFirst) {
    const existingIndex = kept.findIndex((existing) =>
      overlaps(existing, finding),
    );
    if (existingIndex < 0) {
      kept.push(finding);
      continue;
    }
    const existing = kept[existingIndex];
    if (existing !== undefined) {
      // Retain the strongest explanation, but expand its source span to cover
      // every overlapping contextual match. Otherwise redaction could remove
      // only an embedded provider token and leave the surrounding credential.
      kept[existingIndex] = {
        ...existing,
        start: Math.min(existing.start, finding.start),
        end: Math.max(existing.end, finding.end),
      };
    }
  }
  return kept.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
}

function collectFindings(
  content: string,
  languageId?: string,
): InternalFinding[] | null {
  const findings: InternalFinding[] = [];
  const identity = identityView(content);
  const normalized = normalizedView(content);
  const canonical = normalized ?? identity;
  const transformed = transformedTextViews(canonical);
  const decodeBudget: DecodeBudget = {
    candidates: 0,
    bytes: 0,
    exhausted: false,
  };
  const joinedWindowBudget: JoinedWindowBudget = { windows: 0 };
  const seenBase64Candidates = new Set<string>();

  const identityFindings = scanDetectors(
    identity,
    true,
    decodeBudget,
    languageId,
  );
  if (identityFindings === null || !appendBounded(findings, identityFindings))
    return null;
  if (normalized !== null) {
    const normalizedFindings = scanDetectors(
      normalized,
      true,
      decodeBudget,
      languageId,
    );
    if (
      normalizedFindings === null ||
      !appendBounded(findings, normalizedFindings)
    )
      return null;
  }

  for (const view of transformed) {
    const transformedFindings = scanDetectors(
      view,
      true,
      decodeBudget,
      languageId,
    );
    if (
      transformedFindings === null ||
      !appendBounded(findings, transformedFindings)
    )
      return null;
  }

  for (const view of [canonical, ...transformed]) {
    const fixedWindows = lineWrappedFixedViews(view, joinedWindowBudget);
    if (fixedWindows === null) return null;
    for (const joined of fixedWindows) {
      const joinedFindings = scanFixedRules(joined, decodeBudget, true);
      if (decodeBudget.exhausted || !appendBounded(findings, joinedFindings))
        return null;
    }

    const base64Windows = lineWrappedBase64Views(view, joinedWindowBudget);
    if (base64Windows === null) return null;
    for (const joined of base64Windows) {
      const joinedBase64 = scanBase64Candidates(
        joined,
        decodeBudget,
        joinedWindowBudget,
        seenBase64Candidates,
      );
      if (joinedBase64 === null || !appendBounded(findings, joinedBase64))
        return null;
    }

    const base64Findings = scanBase64Candidates(
      view,
      decodeBudget,
      joinedWindowBudget,
      seenBase64Candidates,
    );
    if (base64Findings === null || !appendBounded(findings, base64Findings))
      return null;
  }
  return dedupeOverlaps(findings);
}

function successfulResult(
  content: string,
  inputBytes: number,
  internal: InternalFinding[],
): ScanResult {
  const spanFor = createSpanFactory(content);
  const findings = internal.map((finding) => {
    const score = boundedScore(finding.score);
    return {
      ruleId: finding.ruleId,
      secretType: finding.secretType,
      span: spanFor(finding.start, finding.end),
      score,
      level: levelForScore(score),
      reasons: [...finding.reasons],
      encoding: finding.encoding,
    } satisfies Finding;
  });
  const score = findings.reduce(
    (maximum, finding) => Math.max(maximum, finding.score),
    0,
  );
  const level = levelForScore(score);
  return {
    decision: decisionForLevel(level),
    level,
    score,
    findings,
    complete: true,
    inputBytes,
    rulesetVersion: RULESET_VERSION,
  };
}

/** Synchronously inspect text. This function performs no I/O and never intentionally throws. */
export function scan(input: ScanInput): ScanResult {
  let content: string;
  let inputBytes = 0;
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      typeof input.content !== "string"
    ) {
      return failedResult(0, "scan_error");
    }
    content = input.content;
    inputBytes = utf8Length(content, MAX_INPUT_BYTES);
    if (inputBytes > MAX_INPUT_BYTES)
      return failedResult(inputBytes, "scan_limit");

    const findings = collectFindings(content, input.languageId);
    if (findings === null) return failedResult(inputBytes, "scan_error");
    return successfulResult(content, inputBytes, findings);
  } catch {
    return failedResult(inputBytes, "scan_error");
  }
}

function validSpan(content: string, finding: Finding): boolean {
  const { start, end } = finding.span;
  return (
    Number.isInteger(start.offset) &&
    Number.isInteger(end.offset) &&
    start.offset >= 0 &&
    end.offset >= start.offset &&
    end.offset <= content.length
  );
}

/** Replace original source spans with non-sensitive, deterministic placeholders. */
export function redact(content: string, findings: readonly Finding[]): string {
  const valid = findings
    .filter(
      (finding) =>
        validSpan(content, finding) &&
        finding.span.end.offset > finding.span.start.offset,
    )
    .sort(
      (left, right) =>
        left.span.start.offset - right.span.start.offset ||
        left.span.end.offset - right.span.end.offset ||
        right.score - left.score,
    );
  const merged: Array<{ start: number; end: number; ruleId: string }> = [];
  for (const finding of valid) {
    const start = finding.span.start.offset;
    const end = finding.span.end.offset;
    const previous = merged.at(-1);
    if (previous !== undefined && start <= previous.end) {
      previous.end = Math.max(previous.end, end);
      continue;
    }
    merged.push({ start, end, ruleId: finding.ruleId });
  }

  let redacted = content;
  for (const replacement of merged.reverse()) {
    const { start, end } = replacement;
    const safeRuleId = replacement.ruleId.replace(/[^A-Za-z0-9_]/g, "_");
    redacted = `${redacted.slice(0, start)}<REDACTED_${safeRuleId}>${redacted.slice(end)}`;
  }
  return redacted;
}

/** Redact every finding and authoritatively rescan the exact resulting content. */
export function redactAndRescan(input: ScanInput): SanitizeResult {
  const initial = scan(input);
  const original =
    input !== null &&
    typeof input === "object" &&
    typeof input.content === "string"
      ? input.content
      : "";
  if (!initial.complete) return { initial, content: "", final: initial };
  const content = redact(original, initial.findings);
  const final = scan({ ...input, content });
  return {
    initial,
    content: final.complete && final.decision === "ALLOW" ? content : "",
    final,
  };
}

/** Internal compile-time assertion: every failure type is represented by the public union. */
const _failureTypes: readonly SecretType[] = ["scan_limit", "scan_error"];
void _failureTypes;
