export { redact, redactAndRescan, scan } from "./scanner.js";
export { decisionForLevel, levelForScore } from "./risk.js";
export {
  FIXED_RULE_IDS,
  isExactPublicExample,
  isPlaceholder,
} from "./rules.js";
export { MAX_INPUT_BYTES, RULESET_VERSION } from "./types.js";
export { decodeScannableText } from "./text.js";
export { sha256Hex } from "./sha256.js";
export {
  compileRulesPack,
  CompiledRulesPack,
  SELF_TEST_WORK_BUDGET,
  type CompileOptions,
  type RulesPackCompilation,
  type RulesPackError,
} from "./custom/pack.js";
export {
  validatePattern,
  type PatternError,
  type PatternValidation,
  type SafePattern,
} from "./custom/pattern.js";
export { normalizeTerm, termDigest } from "./custom/terms.js";
export { WorkBudgetExceeded, WorkMeter } from "./custom/work.js";
export type {
  ContextSpec,
  DetectorSpec,
  PatternMatchSpec,
  RulesAction,
  RulesCategory,
  RulesPackPayload,
  TermsMatchSpec,
} from "./custom/schema.js";
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
