export const MAX_INPUT_BYTES = 1_048_576;
export const RULESET_VERSION = "2026-09-11.v0";

export type SourceKind =
  "prompt" | "clipboard" | "selection" | "document" | "text";
export type Decision = "ALLOW" | "WARN" | "BLOCK";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type FindingEncoding =
  | "plain"
  | "normalized"
  | "percent"
  | "json-escaped"
  | "base64"
  | "whitespace-joined";

export type SecretType =
  | "private_key"
  | "provider_token"
  | "access_token"
  | "jwt"
  | "database_credentials"
  | "cloud_credential"
  | "password"
  | "api_key"
  | "generic_secret"
  | "high_entropy"
  | "scan_limit"
  | "scan_error";

export interface ScanInput {
  readonly content: string;
  readonly sourceKind?: SourceKind;
  readonly languageId?: string;
}

/** Offsets and columns use JavaScript/VS Code UTF-16 code units. Lines and columns are 1-based. */
export interface TextPosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

/** Half-open source span: start is inclusive, end is exclusive. */
export interface TextSpan {
  readonly start: TextPosition;
  readonly end: TextPosition;
}

/**
 * A finding deliberately contains no raw value, preview, mask, digest, or user-controlled text.
 * `score` is a deterministic policy score, never a probability.
 */
export interface Finding {
  readonly ruleId: string;
  readonly secretType: SecretType;
  readonly span: TextSpan;
  readonly score: number;
  readonly level: RiskLevel;
  readonly reasons: readonly string[];
  readonly encoding: FindingEncoding;
}

export interface ScanResult {
  readonly decision: Decision;
  readonly level: RiskLevel;
  readonly score: number;
  readonly findings: readonly Finding[];
  /** False means callers must fail closed; no portion of the input was approved. */
  readonly complete: boolean;
  readonly inputBytes: number;
  readonly rulesetVersion: string;
}

export interface SanitizeResult {
  readonly initial: ScanResult;
  readonly content: string;
  readonly final: ScanResult;
}
