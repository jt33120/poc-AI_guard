// Verification and local state of the xSOM rules pack (contract
// RULES-PACK.md §1, §5). Authenticity rests only on the xSOM authority keys
// compiled into this build: a key carried by the envelope is never trusted.

import {
  createHash,
  createPublicKey,
  randomUUID,
  verify,
  type KeyObject,
} from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  compileRulesPack,
  type CompiledRulesPack,
  type RulesPackError,
  type RulesPackPayload,
} from "@xsom/secret-guard-core";
import { canonicalizePolicyPayload } from "./policy-signature.js";

// Replaced at bundle time (esbuild `define`) by the comma-separated base64
// raw Ed25519 public keys of the xSOM rules authority. Absent in unbundled
// builds and tests: every pack is then refused.
declare const __XSOM_RULES_AUTHORITY_KEYS__: string | undefined;

/** Largest envelope accepted from the network or from disk. */
export const MAX_RULES_PACK_BYTES = 4 * 1024 * 1024;

export interface AuthorityKey {
  readonly keyId: string;
  readonly publicKey: string;
  readonly key: KeyObject;
}

export type RulesPackRefusal =
  | "no_authority_key"
  | "malformed_envelope"
  | "unknown_key"
  | "invalid_signature"
  | "invalid_pack"
  | "tenant_mismatch"
  | "tenant_unknown"
  | "version_downgrade"
  | "version_conflict"
  | "too_large"
  | "unreadable";

/**
 * Version history key: the platform numbers versions per (tenant, packId),
 * and a workstation re-enrolled in another organisation starts a new history.
 */
export function historyKey(tenantId: string, packId: string): string {
  return `${packId}@${tenantId}`;
}

/** An own entry of a record: never a property inherited from Object. */
export function ownEntry<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** `YYYY-MM-DDTHH:MM:SSZ`, the form of the signed timestamps (§2). */
export function contractTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

/** The raw build constant, or "" when this build carries no authority key. */
export function builtInAuthorityKeySource(): string {
  return typeof __XSOM_RULES_AUTHORITY_KEYS__ === "string"
    ? __XSOM_RULES_AUTHORITY_KEYS__
    : "";
}

/** `keyId` of a raw 32-byte Ed25519 public key: its SHA-256 in hex. */
export function authorityKeyId(publicKeyBase64: string): string {
  return createHash("sha256")
    .update(Buffer.from(publicKeyBase64, "base64"))
    .digest("hex");
}

/**
 * Parse `XSOM_RULES_AUTHORITY_KEYS`. Any malformed entry makes the whole list
 * unusable: a half-read list must not silently trust fewer or other keys.
 */
export function parseAuthorityKeys(source: string): AuthorityKey[] {
  const entries = source
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  const keys: AuthorityKey[] = [];
  for (const publicKey of entries) {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey)) return [];
    const raw = Buffer.from(publicKey, "base64");
    if (raw.length !== 32) return [];
    try {
      keys.push({
        keyId: authorityKeyId(publicKey),
        publicKey,
        key: createPublicKey({
          key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") },
          format: "jwk",
        }),
      });
    } catch {
      return [];
    }
  }
  return keys;
}

export function builtInAuthorityKeys(): AuthorityKey[] {
  return parseAuthorityKeys(builtInAuthorityKeySource());
}

/** Canonical form of the payload: sorted keys, no whitespace, UTF-8. */
export function canonicalRulesPack(payload: unknown): string {
  return canonicalizePolicyPayload(payload);
}

export interface VerifiedEnvelope {
  readonly payload: Record<string, unknown>;
  readonly keyId: string;
  /** SHA-256 of the canonical payload: the identity reported in posture. */
  readonly digest: string;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type EnvelopeVerification =
  | ({ readonly ok: true } & VerifiedEnvelope)
  | { readonly ok: false; readonly reason: RulesPackRefusal };

/** Check the envelope shape and its Ed25519 signature against built-in keys. */
export function verifyRulesPackEnvelope(
  value: unknown,
  keys: readonly AuthorityKey[],
): EnvelopeVerification {
  if (keys.length === 0) return { ok: false, reason: "no_authority_key" };
  if (
    !isObject(value) ||
    Object.keys(value).length !== 3 ||
    !isObject(value.payload) ||
    typeof value.keyId !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.keyId) ||
    typeof value.signature !== "string" ||
    !/^[A-Za-z0-9+/]{86}==$/.test(value.signature)
  )
    return { ok: false, reason: "malformed_envelope" };
  const authority = keys.find((key) => key.keyId === value.keyId);
  if (authority === undefined) return { ok: false, reason: "unknown_key" };
  let canonical: Buffer;
  try {
    canonical = Buffer.from(canonicalRulesPack(value.payload), "utf8");
  } catch {
    // Pathological nesting: refused, never an exception for the caller.
    return { ok: false, reason: "malformed_envelope" };
  }
  let valid: boolean;
  try {
    valid = verify(
      null,
      canonical,
      authority.key,
      Buffer.from(value.signature, "base64"),
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "invalid_signature" };
  return {
    ok: true,
    payload: value.payload,
    keyId: value.keyId,
    digest: createHash("sha256").update(canonical).digest("hex"),
  };
}

export interface AcceptedVersion {
  readonly version: number;
  readonly digest: string;
}

export interface AcceptanceContext {
  readonly keys: readonly AuthorityKey[];
  /** Tenant this workstation is enrolled in; undefined refuses every pack. */
  readonly enrolledTenant: string | undefined;
  /** Highest version accepted so far, by historyKey (anti-downgrade). */
  readonly highest: Readonly<Record<string, AcceptedVersion>>;
  readonly now: Date;
  /**
   * Digest of a pack whose self-tests this workstation already ran in full.
   * Signature, schema, tenant and version are always re-checked.
   */
  readonly selfTestedDigest?: string;
}

export interface AcceptedRulesPack {
  readonly pack: CompiledRulesPack;
  readonly digest: string;
  readonly keyId: string;
  /** An expired pack stays applied (it only adds protections), but is flagged. */
  readonly expired: boolean;
}

export type RulesPackAcceptance =
  | ({ readonly ok: true } & AcceptedRulesPack)
  | {
      readonly ok: false;
      readonly reason: RulesPackRefusal;
      readonly detail?: RulesPackError;
    };

function quickPayload(payload: Json): RulesPackPayload | undefined {
  const { tenantId, packId, version, expiresAt } = payload;
  return typeof tenantId === "string" &&
    typeof packId === "string" &&
    typeof version === "number" &&
    typeof expiresAt === "string"
    ? (payload as unknown as RulesPackPayload)
    : undefined;
}

/**
 * Decide whether an envelope may be applied on this workstation: authority
 * signature, tenant binding, anti-downgrade, then validity (§2, self-tests
 * included). Any refusal leaves the built-in rules as the only rules.
 */
export function acceptRulesPack(
  envelope: unknown,
  context: AcceptanceContext,
): RulesPackAcceptance {
  const verified = verifyRulesPackEnvelope(envelope, context.keys);
  if (!verified.ok) return verified;
  const payload = quickPayload(verified.payload);
  if (payload === undefined)
    return { ok: false, reason: "invalid_pack", detail: "schema" };
  if (context.enrolledTenant === undefined)
    return { ok: false, reason: "tenant_unknown" };
  if (payload.tenantId !== context.enrolledTenant)
    return { ok: false, reason: "tenant_mismatch" };
  const previous = ownEntry(
    context.highest,
    historyKey(payload.tenantId, payload.packId),
  );
  if (previous !== undefined) {
    if (payload.version < previous.version)
      return { ok: false, reason: "version_downgrade" };
    if (
      payload.version === previous.version &&
      verified.digest !== previous.digest
    )
      return { ok: false, reason: "version_conflict" };
  }
  const compiled = compileRulesPack(verified.payload, {
    selfTests: context.selfTestedDigest !== verified.digest,
  });
  if (!compiled.ok)
    return { ok: false, reason: "invalid_pack", detail: compiled.error };
  return {
    ok: true,
    pack: compiled.pack,
    digest: verified.digest,
    keyId: verified.keyId,
    // Compared as strings, like the validity window (§2): a timestamp that
    // is not a real date cannot turn into NaN here.
    expired: !(payload.expiresAt > contractTimestamp(context.now)),
  };
}

// ---------------------------------------------------------------------------
// Local files: the verified envelope and the state the hook runner re-reads.

export type TenantSource = "register" | "policy" | "first_pack" | "import";

export interface RulesPackSyncRecord {
  readonly at: string;
  readonly outcome: "applied" | "none" | "rejected" | "error";
  readonly reason?: RulesPackRefusal | "sync_failed";
}

export interface RulesPackState {
  readonly schemaVersion: 1;
  readonly tenantId?: string;
  readonly tenantSource?: TenantSource;
  readonly highest: Readonly<Record<string, AcceptedVersion>>;
  readonly selfTestedDigest?: string;
  readonly lastSync?: RulesPackSyncRecord;
}

export const EMPTY_RULES_PACK_STATE: RulesPackState = {
  schemaVersion: 1,
  highest: {},
};

export function rulesPackPath(storage: string): string {
  return join(storage, "rules-pack.json");
}

export function rulesPackStatePath(storage: string): string {
  return join(storage, "rules-pack-state.json");
}

/** Read at most `MAX_RULES_PACK_BYTES`; larger files are refused, not truncated. */
export async function readBoundedFile(
  path: string,
): Promise<string | "absent" | "too_large" | "unreadable"> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    // Only a missing file means "no pack"; any other failure is reported.
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "absent"
      : "unreadable";
  }
  try {
    const buffer = Buffer.alloc(MAX_RULES_PACK_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        size,
        buffer.length - size,
        null,
      );
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > MAX_RULES_PACK_BYTES) return "too_large";
    return buffer.subarray(0, size).toString("utf8");
  } catch {
    return "unreadable";
  } finally {
    await handle.close();
  }
}

function isAcceptedVersion(value: unknown): value is AcceptedVersion {
  return (
    isObject(value) &&
    Number.isInteger(value.version) &&
    typeof value.digest === "string" &&
    /^[0-9a-f]{64}$/.test(value.digest)
  );
}

const SYNC_OUTCOMES: readonly string[] = [
  "applied",
  "none",
  "rejected",
  "error",
];
const SYNC_REASONS: readonly string[] = [
  "no_authority_key",
  "malformed_envelope",
  "unknown_key",
  "invalid_signature",
  "invalid_pack",
  "tenant_mismatch",
  "tenant_unknown",
  "version_downgrade",
  "version_conflict",
  "too_large",
  "unreadable",
  "sync_failed",
];

function isSyncRecord(value: unknown): value is RulesPackSyncRecord {
  return (
    isObject(value) &&
    typeof value.at === "string" &&
    typeof value.outcome === "string" &&
    SYNC_OUTCOMES.includes(value.outcome) &&
    (value.reason === undefined ||
      (typeof value.reason === "string" && SYNC_REASONS.includes(value.reason)))
  );
}

/** The persisted state; unreadable or malformed state reads as empty. */
export async function readRulesPackState(
  storage: string,
): Promise<RulesPackState> {
  const raw = await readBoundedFile(rulesPackStatePath(storage));
  if (raw === "absent" || raw === "too_large" || raw === "unreadable")
    return EMPTY_RULES_PACK_STATE;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isObject(value) ||
      value.schemaVersion !== 1 ||
      !isObject(value.highest)
    )
      return EMPTY_RULES_PACK_STATE;
    // fromEntries defines own properties, even for a key like "__proto__".
    const highest: Record<string, AcceptedVersion> = Object.fromEntries(
      Object.entries(value.highest).filter(([, entry]) =>
        isAcceptedVersion(entry),
      ),
    ) as Record<string, AcceptedVersion>;
    const tenantSource = value.tenantSource;
    const lastSync = value.lastSync;
    return {
      schemaVersion: 1,
      highest,
      ...(typeof value.tenantId === "string" && value.tenantId !== ""
        ? { tenantId: value.tenantId }
        : {}),
      ...(tenantSource === "register" ||
      tenantSource === "policy" ||
      tenantSource === "first_pack" ||
      tenantSource === "import"
        ? { tenantSource }
        : {}),
      ...(typeof value.selfTestedDigest === "string"
        ? { selfTestedDigest: value.selfTestedDigest }
        : {}),
      ...(isSyncRecord(lastSync) ? { lastSync } : {}),
    };
  } catch {
    return EMPTY_RULES_PACK_STATE;
  }
}

/**
 * Write a file readable by this user only, atomically: a unique temporary
 * file, flushed to disk, then renamed over the target. A crash leaves the
 * old or the new content, never an empty file.
 */
export async function writePrivateFile(
  path: string,
  content: string,
): Promise<void> {
  const temporary = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function writeRulesPackState(
  storage: string,
  state: RulesPackState,
): Promise<void> {
  await writePrivateFile(rulesPackStatePath(storage), JSON.stringify(state));
}

export type AppliedRulesPack =
  | { readonly status: "none" }
  | ({ readonly status: "applied" } & AcceptedRulesPack)
  | {
      readonly status: "rejected";
      readonly reason: RulesPackRefusal;
      readonly detail?: RulesPackError;
    };

/**
 * The pack the scanner must apply, re-verified from disk. Used by the hook
 * runner on every invocation and by the extension at start: nothing written
 * in the storage folder is trusted without the authority signature.
 */
export async function loadAppliedRulesPack(
  storage: string,
  keys: readonly AuthorityKey[] = builtInAuthorityKeys(),
  now: Date = new Date(),
): Promise<AppliedRulesPack> {
  const raw = await readBoundedFile(rulesPackPath(storage));
  if (raw === "absent") return { status: "none" };
  if (raw === "too_large" || raw === "unreadable")
    return { status: "rejected", reason: raw };
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return { status: "rejected", reason: "malformed_envelope" };
  }
  const state = await readRulesPackState(storage);
  const accepted = acceptRulesPack(envelope, {
    keys,
    enrolledTenant: state.tenantId,
    highest: state.highest,
    now,
    ...(state.selfTestedDigest === undefined
      ? {}
      : { selfTestedDigest: state.selfTestedDigest }),
  });
  if (!accepted.ok)
    return {
      status: "rejected",
      reason: accepted.reason,
      ...(accepted.detail === undefined ? {} : { detail: accepted.detail }),
    };
  return { status: "applied", ...accepted };
}
