// Validity (contract RULES-PACK.md §2) and compilation of an xSOM rules pack.
// Signature checks belong to the runner; this module only decides whether a
// payload is a pack the scanner may apply, and prepares it.

import {
  compileContext,
  detectAll,
  termGroups,
  TextView,
  type CompiledDetector,
  type CustomMatch,
  type TermGroup,
} from "./detect.js";
import { validatePattern } from "./pattern.js";
import {
  isRulesPackPayload,
  type DetectorSpec,
  type RulesPackPayload,
} from "./schema.js";
import { TooManyMatches, WorkBudgetExceeded, WorkMeter } from "./work.js";

export type RulesPackError =
  | "schema"
  | "duplicate_detector"
  | "validity_window"
  | "too_many_digests"
  | "invalid_pattern"
  | "unknown_test_detector"
  | "missing_positive"
  | "positive_not_detected"
  | "negative_detected"
  // Workstation only: a self-test exceeded its work budget, so the pack
  // could not be proven valid within bounded time.
  | "self_test_incomplete";

const MAX_TOTAL_DIGESTS = 20_000;
/** Work allowed for one self-test text (at most 2 000 characters). */
export const SELF_TEST_WORK_BUDGET = 2_000_000;
/**
 * Work allowed for all the self-tests of one pack together (the largest
 * pack the contract allows needs about 37 M units).
 */
export const SELF_TESTS_TOTAL_BUDGET = 150_000_000;

/** A valid pack, compiled for the scanner. Immutable and reusable across scans. */
export class CompiledRulesPack {
  /** @internal */
  public readonly groups: readonly TermGroup[];

  /** @internal */
  public constructor(
    public readonly payload: RulesPackPayload,
    public readonly detectors: readonly CompiledDetector[],
  ) {
    this.groups = termGroups(detectors);
  }

  public get packId(): string {
    return this.payload.packId;
  }

  public get version(): number {
    return this.payload.version;
  }

  public get tenantId(): string {
    return this.payload.tenantId;
  }

  public get expiresAt(): string {
    return this.payload.expiresAt;
  }

  public get detectorCount(): number {
    return this.detectors.length;
  }

  /**
   * Detections per detector. Throws WorkBudgetExceeded past the meter and
   * TooManyMatches past `maxMatches` kept detections.
   */
  public detect(
    text: string,
    meter: WorkMeter,
    only?: ReadonlySet<number>,
    maxMatches?: number,
  ): CustomMatch[][] {
    return detectAll(
      this.detectors,
      this.groups,
      new TextView(text, meter, maxMatches),
      meter,
      only,
    );
  }
}

export type RulesPackCompilation =
  | { readonly ok: true; readonly pack: CompiledRulesPack }
  | { readonly ok: false; readonly error: RulesPackError };

/** Compile one detector; undefined when its pattern is invalid. */
export function compileDetector(
  detector: DetectorSpec,
): CompiledDetector | undefined {
  const context = compileContext(detector.context);
  const { match } = detector;
  if (match.type === "terms")
    return {
      kind: "terms",
      spec: detector,
      salt: match.salt,
      digests: new Set(match.digests),
      maxWords: match.maxWords,
      ...(context === undefined ? {} : { context }),
    };
  const validation = validatePattern(
    match.pattern,
    detector.context !== undefined,
    match.caseInsensitive === true,
  );
  if (!validation.ok) return undefined;
  return {
    kind: "pattern",
    spec: detector,
    pattern: validation.pattern,
    ...(match.minEntropyTenths === undefined
      ? {}
      : { minEntropyTenths: match.minEntropyTenths }),
    ...(context === undefined ? {} : { context }),
  };
}

function selfTest(
  pack: CompiledRulesPack,
  text: string,
  total: WorkMeter,
  only?: ReadonlySet<number>,
): CustomMatch[][] | undefined {
  try {
    return pack.detect(text, new WorkMeter(SELF_TEST_WORK_BUDGET, total), only);
  } catch (error) {
    if (error instanceof WorkBudgetExceeded || error instanceof TooManyMatches)
      return undefined;
    throw error;
  }
}

function fail(error: RulesPackError): RulesPackCompilation {
  return { ok: false, error };
}

export interface CompileOptions {
  /**
   * Run the pack's positive and negative self-tests (§2 steps 8 and 9).
   * Only a caller that already ran them on this exact payload may skip them.
   */
  readonly selfTests?: boolean;
}

/**
 * Check a payload against §2, in the contract's order, and compile it. The
 * pack's own positive and negative self-tests run here, so a pack that does
 * not detect what xSOM calibrated it for is never applied.
 */
export function compileRulesPack(
  payload: unknown,
  options: CompileOptions = {},
): RulesPackCompilation {
  if (!isRulesPackPayload(payload)) return fail("schema");
  const ids = payload.detectors.map((detector) => detector.id);
  if (new Set(ids).size !== ids.length) return fail("duplicate_detector");
  if (!(payload.expiresAt > payload.issuedAt)) return fail("validity_window");
  const digests = payload.detectors.reduce(
    (total, detector) =>
      total +
      (detector.match.type === "terms" ? detector.match.digests.length : 0),
    0,
  );
  if (digests > MAX_TOTAL_DIGESTS) return fail("too_many_digests");
  const detectors: CompiledDetector[] = [];
  for (const detector of payload.detectors) {
    const compiled = compileDetector(detector);
    if (compiled === undefined) return fail("invalid_pattern");
    detectors.push(compiled);
  }
  const { positives, negatives } = payload.tests;
  const indexOf = new Map(ids.map((id, index) => [id, index]));
  if (positives.some((positive) => !indexOf.has(positive.detector)))
    return fail("unknown_test_detector");
  const tested = new Set(positives.map((positive) => positive.detector));
  if (
    payload.detectors.some(
      (detector) =>
        detector.match.type === "pattern" && !tested.has(detector.id),
    )
  )
    return fail("missing_positive");

  const pack = new CompiledRulesPack(payload, detectors);
  if (options.selfTests === false) return { ok: true, pack };
  const total = new WorkMeter(SELF_TESTS_TOTAL_BUDGET);
  for (const positive of positives) {
    const index = indexOf.get(positive.detector) as number;
    const results = selfTest(pack, positive.text, total, new Set([index]));
    if (results === undefined) return fail("self_test_incomplete");
    if ((results[index] ?? []).length === 0)
      return fail("positive_not_detected");
  }
  for (const negative of negatives) {
    const results = selfTest(pack, negative, total);
    if (results === undefined) return fail("self_test_incomplete");
    if (results.some((matches) => matches.length > 0))
      return fail("negative_detected");
  }
  return { ok: true, pack };
}
