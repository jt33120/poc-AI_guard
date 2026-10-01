import {
  isPlaceholder,
  redactAndRescan,
  scan,
  type CompiledRulesPack,
  type ScanInput,
} from "@xsom/secret-guard-core";

/** Ceilings: a request outside them is refused, never forwarded unscanned. */
export const MAX_REQUEST_BYTES = 16 * 1_048_576;
export const MAX_TEXT_BYTES = 8 * 1_048_576;
const MAX_DEPTH = 40;

// Model name, parameters and metadata are not prompt text and stay untouched.
const INSPECTED_FIELDS = ["messages", "system", "tools"] as const;
// Protocol identifiers link a tool call to its result: never rewritten.
const PROTOCOL_KEYS = new Set(["type", "role", "id", "tool_use_id", "name"]);
const SENSITIVE_KEY =
  /^(?:[a-z0-9]+[_-])?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|access[_-]?token|client[_-]?secret)$/i;
const FIELD_KIND = "sensitive_field";
const FIELD_MARKER = `<REDACTED_${FIELD_KIND}>`;

/** What to do with an image or a document, which the local detector cannot read. */
export type UnanalysedPolicy = "refuse" | "allow";

export type RefusalReason =
  | "request_too_large"
  | "invalid_json"
  | "messages_required"
  | "request_too_deep"
  | "scan_incomplete"
  | "redaction_incomplete"
  | "secret_in_protocol_identifier"
  | "secret_in_signed_thinking"
  | "signed_thinking_unreadable"
  | "unanalysed_attachment";

export interface CleanOptions {
  readonly unanalysed?: UnanalysedPolicy;
  readonly rules?: CompiledRulesPack;
  /** Bound of the in-memory analysis cache, in bytes of text (64 MiB by default). */
  readonly cacheBytes?: number;
}

/** Counts and types only: a result never carries a detected value. */
export type CleanResult =
  | {
      readonly ok: true;
      readonly body: Buffer;
      readonly redactions: number;
      readonly kinds: readonly string[];
      readonly unanalysed: number;
    }
  | { readonly ok: false; readonly reason: RefusalReason };

class Refusal extends Error {
  constructor(readonly reason: RefusalReason) {
    super(reason);
  }
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What one text yields; `cleaned` is undefined when redaction failed. */
interface Analysis {
  readonly complete: boolean;
  readonly blocks: boolean;
  readonly kinds: readonly string[];
  readonly cleaned: string | undefined;
}

// Claude Code resends the whole conversation on every turn: each text is
// analysed once per session, then reused. Memory only, bounded, never written.
const DEFAULT_CACHE_BYTES = 64 * 1_048_576;

class AnalysisCache {
  private readonly entries = new Map<string, Analysis>();
  private bytes = 0;
  private readonly limit: number;

  constructor(private readonly options: CleanOptions) {
    this.limit = options.cacheBytes ?? DEFAULT_CACHE_BYTES;
  }

  analyse(value: string): Analysis {
    const known = this.entries.get(value);
    if (known !== undefined) {
      // Refresh: the oldest entries are evicted first.
      this.entries.delete(value);
      this.entries.set(value, known);
      return known;
    }
    const analysis = this.compute(value);
    this.store(value, analysis);
    return analysis;
  }

  private compute(value: string): Analysis {
    const input = this.input(value);
    const result = scan(input);
    if (!result.complete || result.findings.length === 0)
      return {
        complete: result.complete,
        blocks: false,
        kinds: [],
        cleaned: value,
      };
    const sanitized = redactAndRescan(input);
    const clean =
      sanitized.final.complete && sanitized.final.decision === "ALLOW";
    return {
      complete: true,
      blocks: result.decision === "BLOCK",
      kinds: result.findings.map((finding) => finding.ruleId),
      cleaned: clean ? sanitized.content : undefined,
    };
  }

  private store(value: string, analysis: Analysis): void {
    const size = value.length * 2;
    if (size > this.limit) return;
    this.entries.set(value, analysis);
    this.bytes += size;
    for (const key of this.entries.keys()) {
      if (this.bytes <= this.limit) break;
      this.entries.delete(key);
      this.bytes -= key.length * 2;
    }
  }

  private input(content: string): ScanInput {
    return this.options.rules === undefined
      ? { content, sourceKind: "prompt" }
      : { content, sourceKind: "prompt", rules: this.options.rules };
  }
}

/** One request's walk: the text budget and the counters it accumulates. */
class Walk {
  redactions = 0;
  unanalysed = 0;
  readonly kinds = new Set<string>();
  private textBytes = 0;

  constructor(
    private readonly options: CleanOptions,
    private readonly cache: AnalysisCache,
  ) {}

  visit(value: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) throw new Refusal("request_too_deep");
    if (typeof value === "string") return this.text(value);
    if (Array.isArray(value))
      return value.map((item) => this.visit(item, depth + 1));
    if (isRecord(value)) return this.block(value, depth);
    return value;
  }

  private block(value: Json, depth: number): unknown {
    switch (value.type) {
      case "image":
      case "document":
        if (this.options.unanalysed !== "allow")
          throw new Refusal("unanalysed_attachment");
        this.unanalysed += 1;
        return value;
      case "redacted_thinking":
        // Encrypted by the provider, produced by the model: no user text to clean.
        return value;
      case "thinking":
        if (typeof value.thinking !== "string")
          throw new Refusal("signed_thinking_unreadable");
        // Signed: it cannot be edited, so a secret in it stops the request.
        if (this.analyse(value.thinking).kinds.length > 0)
          throw new Refusal("secret_in_signed_thinking");
        return value;
      default:
        // fromEntries defines "__proto__" as plain data, never as a prototype.
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            this.field(key, item, depth),
          ]),
        );
    }
  }

  private field(key: string, item: unknown, depth: number): unknown {
    if (
      SENSITIVE_KEY.test(key) &&
      (typeof item === "number" ||
        (typeof item === "string" && item !== "" && !isPlaceholder(item)))
    ) {
      this.count(FIELD_KIND);
      return FIELD_MARKER;
    }
    if (PROTOCOL_KEYS.has(key) && typeof item === "string") {
      if (this.analyse(item).blocks)
        throw new Refusal("secret_in_protocol_identifier");
      return item;
    }
    return this.visit(item, depth + 1);
  }

  private text(value: string): string {
    const analysis = this.analyse(value);
    if (analysis.kinds.length === 0) return value;
    if (analysis.cleaned === undefined)
      throw new Refusal("redaction_incomplete");
    for (const kind of analysis.kinds) this.count(kind);
    return analysis.cleaned;
  }

  private analyse(value: string): Analysis {
    this.textBytes += Buffer.byteLength(value, "utf8");
    if (this.textBytes > MAX_TEXT_BYTES) throw new Refusal("request_too_large");
    const analysis = this.cache.analyse(value);
    if (!analysis.complete) throw new Refusal("scan_incomplete");
    return analysis;
  }

  private count(kind: string): void {
    this.redactions += 1;
    this.kinds.add(kind);
  }
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

function parse(body: Buffer): unknown {
  try {
    return JSON.parse(UTF8.decode(body)) as unknown;
  } catch {
    throw new Refusal("invalid_json");
  }
}

export interface Cleaner {
  clean: (body: Buffer) => CleanResult;
}

/**
 * Cleans Anthropic Messages requests: every detected secret is replaced by a
 * marker and the result is scanned again. A request that cannot be fully
 * cleaned is refused; nothing unscanned is ever returned. The cleaner keeps
 * its analyses in memory, so a conversation resent turn after turn is only
 * analysed once.
 */
export function createCleaner(options: CleanOptions = {}): Cleaner {
  const cache = new AnalysisCache(options);
  return { clean: (body) => clean(body, options, cache) };
}

/** One-off cleaning, without reuse between requests. */
export function cleanRequest(
  body: Buffer,
  options: CleanOptions = {},
): CleanResult {
  return createCleaner(options).clean(body);
}

function clean(
  body: Buffer,
  options: CleanOptions,
  cache: AnalysisCache,
): CleanResult {
  try {
    if (body.length > MAX_REQUEST_BYTES) throw new Refusal("request_too_large");
    const data = parse(body);
    if (!isRecord(data) || !Array.isArray(data.messages))
      throw new Refusal("messages_required");
    const walk = new Walk(options, cache);
    for (const field of INSPECTED_FIELDS)
      if (field in data) data[field] = walk.visit(data[field], 0);
    const summary = {
      redactions: walk.redactions,
      kinds: [...walk.kinds].sort(),
      unanalysed: walk.unanalysed,
    };
    // Nothing replaced: the provider receives the request byte for byte.
    if (walk.redactions === 0) return { ok: true, body, ...summary };
    const cleaned = Buffer.from(JSON.stringify(data), "utf8");
    if (cleaned.length > MAX_REQUEST_BYTES)
      throw new Refusal("request_too_large");
    return { ok: true, body: cleaned, ...summary };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.reason };
    throw error;
  }
}
