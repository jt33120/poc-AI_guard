export { redact, redactAndRescan, scan } from "./scanner.js";
export { decisionForLevel, levelForScore } from "./risk.js";
export {
  FIXED_RULE_IDS,
  isExactPublicExample,
  isPlaceholder,
} from "./rules.js";
export { MAX_INPUT_BYTES, RULESET_VERSION } from "./types.js";
export type {
  Decision,
  Finding,
  FindingEncoding,
  RiskLevel,
  SanitizeResult,
  ScanInput,
  ScanResult,
  SecretType,
  SourceKind,
  TextPosition,
  TextSpan,
} from "./types.js";
