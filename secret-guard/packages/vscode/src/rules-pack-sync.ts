// Synchronisation of the xSOM rules pack (contract RULES-PACK.md §7): fetched
// next to the managed policy, verified with the authority keys compiled into
// this build, then written where the hook runner reads it again.

import { rm } from "node:fs/promises";
import {
  acceptRulesPack,
  builtInAuthorityKeys,
  loadAppliedRulesPack,
  MAX_RULES_PACK_BYTES,
  readRulesPackState,
  rulesPackPath,
  verifyRulesPackEnvelope,
  writePrivateFile,
  writeRulesPackState,
  type AcceptedVersion,
  type AppliedRulesPack,
  type AuthorityKey,
  type RulesPackRefusal,
  type RulesPackState,
  type RulesPackSyncRecord,
  type TenantSource,
} from "@xsom/developer-guard-runner";
import { gatewayUrl } from "./gateway-client.js";

export const RULES_PACK_ROUTE = "/v1/extension/rules-pack";

/**
 * `GET /v1/extension/rules-pack`: the envelope, or null when the tenant has no
 * tuning. The body can reach a few megabytes (20 000 digests), hence its own
 * bounded reader instead of the 64 kB policy reader.
 */
export async function fetchRulesPack(
  endpoint: string,
  token: string,
): Promise<unknown> {
  const response = await fetch(`${gatewayUrl(endpoint)}${RULES_PACK_ROUTE}`, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: { "X-Gateway-Token": token },
  });
  if (!response.ok) throw new Error(`gateway_http_${String(response.status)}`);
  if (!response.body) throw new Error("gateway_response_empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_RULES_PACK_BYTES + 64) {
        await reader.cancel();
        throw new Error("rules_pack_too_large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !("rulesPack" in body)
  )
    throw new Error("rules_pack_response_invalid");
  return (body as { rulesPack: unknown }).rulesPack;
}

export interface EnrolledTenant {
  readonly id: string;
  readonly source: "register" | "policy";
}

export interface RulesPackSyncOptions {
  readonly keys?: readonly AuthorityKey[];
  readonly now?: Date;
  /** Tenant stated by the platform at registration or by the signed policy. */
  readonly enrolledTenant?: EnrolledTenant;
  readonly fetchPack?: (endpoint: string, token: string) => Promise<unknown>;
}

export type RulesPackSyncOutcome =
  | { readonly outcome: "applied"; readonly digest: string }
  | { readonly outcome: "none" }
  | { readonly outcome: "rejected"; readonly reason: RulesPackRefusal }
  | { readonly outcome: "error" };

function record(
  now: Date,
  outcome: RulesPackSyncRecord["outcome"],
  reason?: RulesPackSyncRecord["reason"],
): RulesPackSyncRecord {
  return {
    at: now.toISOString(),
    outcome,
    ...(reason === undefined ? {} : { reason }),
  };
}

function tenantFor(
  state: RulesPackState,
  enrolled: EnrolledTenant | undefined,
): { id: string; source: TenantSource } | undefined {
  // A tenant stated by the platform replaces a tenant learned from a pack.
  if (enrolled !== undefined) return enrolled;
  if (state.tenantId === undefined) return undefined;
  return { id: state.tenantId, source: state.tenantSource ?? "first_pack" };
}

/**
 * Fetch, verify and store the pack. A refused or unreachable pack leaves the
 * previously verified pack (if any) and the built-in rules untouched; the
 * outcome is recorded for the status and the posture.
 */
export async function syncRulesPack(
  endpoint: string,
  token: string,
  storage: string,
  options: RulesPackSyncOptions = {},
): Promise<RulesPackSyncOutcome> {
  const now = options.now ?? new Date();
  const keys = options.keys ?? builtInAuthorityKeys();
  const state = await readRulesPackState(storage);
  let envelope: unknown;
  try {
    envelope = await (options.fetchPack ?? fetchRulesPack)(endpoint, token);
  } catch {
    await writeRulesPackState(storage, {
      ...state,
      lastSync: record(now, "error", "sync_failed"),
    });
    return { outcome: "error" };
  }
  const known = tenantFor(state, options.enrolledTenant);
  const pinned =
    known === undefined
      ? {}
      : { tenantId: known.id, tenantSource: known.source };
  if (envelope === null) {
    // The tenant has no tuning (any more): back to the built-in rules only.
    // The version history stays, so an older pack cannot come back later.
    await rm(rulesPackPath(storage), { force: true });
    await writeRulesPackState(storage, {
      ...state,
      ...pinned,
      lastSync: record(now, "none"),
    });
    return { outcome: "none" };
  }
  return applyEnvelope(storage, envelope, state, known, "first_pack", {
    keys,
    now,
  });
}

/**
 * Verify an envelope and store it when accepted. Shared by the online
 * synchronisation and the offline import: the same checks, the same files.
 */
async function applyEnvelope(
  storage: string,
  envelope: unknown,
  state: RulesPackState,
  known: { id: string; source: TenantSource } | undefined,
  firstSource: "first_pack" | "import",
  { keys, now }: { keys: readonly AuthorityKey[]; now: Date },
): Promise<RulesPackSyncOutcome> {
  const pinned =
    known === undefined
      ? {}
      : { tenantId: known.id, tenantSource: known.source };
  let tenant = known;
  if (tenant === undefined) {
    // First pack of this enrollment: its signed tenant becomes the enrolled
    // tenant (online: it came over the channel authenticated as this
    // workstation; offline: an administrator chose to import it).
    const verified = verifyRulesPackEnvelope(envelope, keys);
    const signedTenant = verified.ok ? verified.payload.tenantId : undefined;
    if (typeof signedTenant === "string" && signedTenant !== "")
      tenant = { id: signedTenant, source: firstSource };
  }
  const accepted = acceptRulesPack(envelope, {
    keys,
    enrolledTenant: tenant?.id,
    highest: state.highest,
    now,
  });
  if (!accepted.ok) {
    await writeRulesPackState(storage, {
      ...state,
      ...pinned,
      lastSync: record(now, "rejected", accepted.reason),
    });
    return { outcome: "rejected", reason: accepted.reason };
  }
  // Several VS Code windows may synchronise at once: re-read the state and
  // never replace a newer pack another window has already applied.
  const fresh = await readRulesPackState(storage);
  const newer = fresh.highest[accepted.pack.packId];
  if (newer !== undefined && newer.version > accepted.pack.version)
    return { outcome: "applied", digest: newer.digest };
  await writePrivateFile(rulesPackPath(storage), JSON.stringify(envelope));
  await writeRulesPackState(storage, {
    schemaVersion: 1,
    tenantId: accepted.pack.tenantId,
    tenantSource: tenant?.source ?? firstSource,
    highest: {
      ...mergeHighest(state.highest, fresh.highest),
      [accepted.pack.packId]: {
        version: accepted.pack.version,
        digest: accepted.digest,
      },
    },
    selfTestedDigest: accepted.digest,
    lastSync: record(now, "applied"),
  });
  return { outcome: "applied", digest: accepted.digest };
}

/**
 * Offline import for air-gapped workstations (Renforcé): a pack file handed
 * over by xSOM goes through exactly the checks of a synchronisation. The
 * first import fixes the tenant; later ones must match it.
 */
export async function importRulesPack(
  storage: string,
  raw: string,
  options: Pick<RulesPackSyncOptions, "keys" | "now"> = {},
): Promise<RulesPackSyncOutcome> {
  const now = options.now ?? new Date();
  const keys = options.keys ?? builtInAuthorityKeys();
  const state = await readRulesPackState(storage);
  if (Buffer.byteLength(raw, "utf8") > MAX_RULES_PACK_BYTES) {
    await writeRulesPackState(storage, {
      ...state,
      lastSync: record(now, "rejected", "too_large"),
    });
    return { outcome: "rejected", reason: "too_large" };
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    envelope = undefined;
  }
  return applyEnvelope(
    storage,
    envelope,
    state,
    tenantFor(state, undefined),
    "import",
    {
      keys,
      now,
    },
  );
}

function mergeHighest(
  left: RulesPackState["highest"],
  right: RulesPackState["highest"],
): Record<string, AcceptedVersion> {
  const merged: Record<string, AcceptedVersion> = { ...left };
  for (const [packId, entry] of Object.entries(right)) {
    const current = merged[packId];
    if (current === undefined || entry.version > current.version)
      merged[packId] = entry;
  }
  return merged;
}

/** Forget the tenant learned from this enrollment (on disconnection). */
export async function forgetEnrollment(storage: string): Promise<void> {
  const state = await readRulesPackState(storage);
  await rm(rulesPackPath(storage), { force: true });
  await writeRulesPackState(storage, {
    schemaVersion: 1,
    highest: state.highest,
  });
}

export interface RulesPackSnapshot {
  readonly applied: AppliedRulesPack;
  readonly lastSync?: RulesPackSyncRecord;
  readonly enrolled: boolean;
  readonly authorityKeys: number;
}

/** What the scanner applies now, re-verified from disk, with the last sync. */
export async function readRulesPackSnapshot(
  storage: string,
  keys: readonly AuthorityKey[] = builtInAuthorityKeys(),
  now: Date = new Date(),
): Promise<RulesPackSnapshot> {
  const [applied, state] = await Promise.all([
    loadAppliedRulesPack(storage, keys, now),
    readRulesPackState(storage),
  ]);
  return {
    applied,
    ...(state.lastSync === undefined ? {} : { lastSync: state.lastSync }),
    enrolled: state.tenantId !== undefined || state.lastSync !== undefined,
    authorityKeys: keys.length,
  };
}
