// Structural validation of a rules pack payload, equivalent to
// secret-guard/contracts/rules-pack.schema.json (draft 2020-12). String
// lengths count Unicode code points, as JSON Schema does.

export type RulesCategory =
  | "credential"
  | "customer_data"
  | "personal_data"
  | "internal_infra"
  | "project";

export type RulesAction = "warn" | "block";

export interface PatternMatchSpec {
  readonly type: "pattern";
  readonly pattern: string;
  readonly caseInsensitive?: boolean;
  readonly minEntropyTenths?: number;
}

export interface TermsMatchSpec {
  readonly type: "terms";
  readonly salt: string;
  readonly digests: readonly string[];
  readonly maxWords: number;
}

export interface ContextSpec {
  readonly keywords: readonly string[];
  readonly window: number;
}

export interface DetectorSpec {
  readonly id: string;
  readonly label: string;
  readonly category: RulesCategory;
  readonly action: RulesAction;
  readonly match: PatternMatchSpec | TermsMatchSpec;
  readonly context?: ContextSpec;
}

export interface RulesPackPayload {
  readonly schemaVersion: 1;
  readonly kind: "xsom.secret-guard.rules-pack";
  readonly packId: string;
  readonly tenantId: string;
  readonly version: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly issuer: string;
  readonly detectors: readonly DetectorSpec[];
  readonly tests: {
    readonly positives: readonly {
      readonly detector: string;
      readonly text: string;
    }[];
    readonly negatives: readonly string[];
  };
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
const KEYWORD = /^[A-Za-z0-9][A-Za-z0-9 _.@:/-]{1,39}$/;
const SALT = /^[A-Za-z0-9+/]{22}==$|^[A-Za-z0-9+/]{43}=$/;
const DIGEST = /^[0-9a-f]{64}$/;
const CATEGORIES: readonly string[] = [
  "credential",
  "customer_data",
  "personal_data",
  "internal_infra",
  "project",
];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(
  value: Json,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function codePoints(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
}

function isText(value: unknown, min: number, max: number): value is string {
  if (typeof value !== "string") return false;
  const length = codePoints(value);
  return length >= min && length <= max;
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function isArray(value: unknown, min: number, max: number): value is unknown[] {
  return Array.isArray(value) && value.length >= min && value.length <= max;
}

function unique(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

function isContext(value: unknown): boolean {
  return (
    isObject(value) &&
    hasOnly(value, ["keywords", "window"]) &&
    isArray(value.keywords, 1, 20) &&
    value.keywords.every(
      (keyword) => typeof keyword === "string" && KEYWORD.test(keyword),
    ) &&
    unique(value.keywords) &&
    isInteger(value.window, 1, 256)
  );
}

function isPatternMatch(value: Json): boolean {
  return (
    hasOnly(
      value,
      ["type", "pattern"],
      ["caseInsensitive", "minEntropyTenths"],
    ) &&
    value.type === "pattern" &&
    isText(value.pattern, 1, 256) &&
    (value.caseInsensitive === undefined ||
      typeof value.caseInsensitive === "boolean") &&
    (value.minEntropyTenths === undefined ||
      isInteger(value.minEntropyTenths, 0, 80))
  );
}

function isTermsMatch(value: Json): boolean {
  return (
    hasOnly(value, ["type", "salt", "digests", "maxWords"]) &&
    value.type === "terms" &&
    typeof value.salt === "string" &&
    SALT.test(value.salt) &&
    isArray(value.digests, 1, 5000) &&
    value.digests.every(
      (digest) => typeof digest === "string" && DIGEST.test(digest),
    ) &&
    unique(value.digests) &&
    isInteger(value.maxWords, 1, 4)
  );
}

function isDetector(value: unknown): boolean {
  if (
    !isObject(value) ||
    !hasOnly(value, ["id", "label", "category", "action", "match"], ["context"])
  )
    return false;
  const match = value.match;
  return (
    typeof value.id === "string" &&
    IDENTIFIER.test(value.id) &&
    isText(value.label, 1, 80) &&
    typeof value.category === "string" &&
    CATEGORIES.includes(value.category) &&
    (value.action === "warn" || value.action === "block") &&
    isObject(match) &&
    // oneOf: the constant `type` makes the two branches exclusive.
    (isPatternMatch(match) || isTermsMatch(match)) &&
    (value.context === undefined || isContext(value.context))
  );
}

function isTests(value: unknown): boolean {
  return (
    isObject(value) &&
    hasOnly(value, ["positives", "negatives"]) &&
    isArray(value.positives, 0, 200) &&
    value.positives.every(
      (positive) =>
        isObject(positive) &&
        hasOnly(positive, ["detector", "text"]) &&
        typeof positive.detector === "string" &&
        IDENTIFIER.test(positive.detector) &&
        isText(positive.text, 1, 2000),
    ) &&
    isArray(value.negatives, 0, 200) &&
    value.negatives.every((negative) => isText(negative, 1, 2000))
  );
}

/** True when `value` satisfies rules-pack.schema.json. */
export function isRulesPackPayload(value: unknown): value is RulesPackPayload {
  return (
    isObject(value) &&
    hasOnly(value, [
      "schemaVersion",
      "kind",
      "packId",
      "tenantId",
      "version",
      "issuedAt",
      "expiresAt",
      "issuer",
      "detectors",
      "tests",
    ]) &&
    value.schemaVersion === 1 &&
    value.kind === "xsom.secret-guard.rules-pack" &&
    typeof value.packId === "string" &&
    IDENTIFIER.test(value.packId) &&
    isText(value.tenantId, 1, 128) &&
    isInteger(value.version, 1, 2147483647) &&
    typeof value.issuedAt === "string" &&
    TIMESTAMP.test(value.issuedAt) &&
    typeof value.expiresAt === "string" &&
    TIMESTAMP.test(value.expiresAt) &&
    isText(value.issuer, 1, 80) &&
    isArray(value.detectors, 1, 200) &&
    value.detectors.every(isDetector) &&
    isTests(value.tests)
  );
}
