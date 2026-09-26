import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptRulesPack,
  authorityKeyId,
  builtInAuthorityKeys,
  canonicalRulesPack,
  EMPTY_RULES_PACK_STATE,
  loadAppliedRulesPack,
  MAX_RULES_PACK_BYTES,
  parseAuthorityKeys,
  readRulesPackState,
  rulesPackPath,
  verifyRulesPackEnvelope,
  writeRulesPackState,
  type AcceptanceContext,
} from "../../packages/runner/src/index.js";

interface SignatureVector {
  seedBase64: string;
  publicKeyBase64: string;
  keyId: string;
  canonicalPayload: string;
  payloadDigest: string;
  envelope: {
    payload: Record<string, unknown>;
    keyId: string;
    signature: string;
  };
  tampered: { payloadPatch: Record<string, unknown> };
}

const vectors = JSON.parse(
  readFileSync(
    new URL(
      "../../contracts/fixtures/rules-pack-vectors.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  signature: SignatureVector;
  packs: { name: string; pack: Record<string, unknown>; valid: boolean }[];
};
const vector = vectors.signature;
const TENANT = "00000000-0000-4000-8000-000000000001";
// The public TEST authority of the contract vectors; never a production key.
const testKeys = parseAuthorityKeys(vector.publicKeyBase64);

function privateKeyFromSeed(seedBase64: string): KeyObject {
  const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  return createPrivateKey({
    key: Buffer.concat([prefix, Buffer.from(seedBase64, "base64")]),
    format: "der",
    type: "pkcs8",
  });
}

const testPrivateKey = privateKeyFromSeed(vector.seedBase64);

function rawPublicKey(key: KeyObject): string {
  const jwk = createPublicKey(key).export({ format: "jwk" }) as { x: string };
  return Buffer.from(jwk.x, "base64url").toString("base64");
}

function signed(
  payload: Record<string, unknown>,
  privateKey: KeyObject = testPrivateKey,
): { payload: Record<string, unknown>; keyId: string; signature: string } {
  return {
    payload,
    keyId: authorityKeyId(rawPublicKey(privateKey)),
    signature: sign(
      null,
      Buffer.from(canonicalRulesPack(payload), "utf8"),
      privateKey,
    ).toString("base64"),
  };
}

function context(
  overrides: Partial<AcceptanceContext> = {},
): AcceptanceContext {
  return {
    keys: testKeys,
    enrolledTenant: TENANT,
    highest: {},
    now: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

const reference = vector.envelope.payload;

describe("rules pack signature (contract §1)", () => {
  it("reproduces the signature vector", () => {
    expect(rawPublicKey(testPrivateKey)).toBe(vector.publicKeyBase64);
    expect(authorityKeyId(vector.publicKeyBase64)).toBe(vector.keyId);
    expect(canonicalRulesPack(vector.envelope.payload)).toBe(
      vector.canonicalPayload,
    );
    const verified = verifyRulesPackEnvelope(vector.envelope, testKeys);
    expect(verified).toMatchObject({
      ok: true,
      keyId: vector.keyId,
      digest: vector.payloadDigest,
    });
    // Ed25519 is deterministic: signing the canonical form again gives the
    // vector's signature byte for byte.
    expect(signed(reference).signature).toBe(vector.envelope.signature);
  });

  it("rejects the tampered vector", () => {
    const tampered = {
      ...vector.envelope,
      payload: { ...vector.envelope.payload, ...vector.tampered.payloadPatch },
    };
    expect(verifyRulesPackEnvelope(tampered, testKeys)).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("refuses every pack in a build without authority key", () => {
    expect(builtInAuthorityKeys()).toEqual([]);
    expect(verifyRulesPackEnvelope(vector.envelope, [])).toEqual({
      ok: false,
      reason: "no_authority_key",
    });
  });

  it("parses the build list strictly", () => {
    const other = rawPublicKey(generateKeyPairSync("ed25519").privateKey);
    expect(
      parseAuthorityKeys(` ${vector.publicKeyBase64}, ${other} `).map(
        (key) => key.keyId,
      ),
    ).toEqual([vector.keyId, authorityKeyId(other)]);
    // One malformed entry disables the whole list rather than trusting a part.
    expect(parseAuthorityKeys(`${vector.publicKeyBase64},not-a-key`)).toEqual(
      [],
    );
    expect(parseAuthorityKeys(Buffer.alloc(16).toString("base64"))).toEqual([]);
    expect(parseAuthorityKeys("")).toEqual([]);
  });
});

describe("hostile envelopes", () => {
  const attacker = generateKeyPairSync("ed25519").privateKey;

  it("never trusts a key carried by the envelope", () => {
    const forged = signed(reference, attacker);
    expect(verifyRulesPackEnvelope(forged, testKeys)).toEqual({
      ok: false,
      reason: "unknown_key",
    });
    expect(
      verifyRulesPackEnvelope(
        { ...forged, publicKey: rawPublicKey(attacker) },
        testKeys,
      ),
    ).toEqual({ ok: false, reason: "malformed_envelope" });
    // The official keyId with the attacker's signature.
    expect(
      verifyRulesPackEnvelope({ ...forged, keyId: vector.keyId }, testKeys),
    ).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects forged and malformed signatures", () => {
    for (const signature of [
      Buffer.alloc(64, 7).toString("base64"),
      vector.envelope.signature.replace(/^./, "A"),
    ])
      expect(
        verifyRulesPackEnvelope({ ...vector.envelope, signature }, testKeys),
      ).toMatchObject({ ok: false });
    for (const envelope of [
      null,
      [],
      "pack",
      { payload: reference },
      { ...vector.envelope, keyId: "ABC" },
      { ...vector.envelope, signature: "short" },
      { ...vector.envelope, payload: [] },
    ])
      expect(verifyRulesPackEnvelope(envelope, testKeys)).toEqual({
        ok: false,
        reason: "malformed_envelope",
      });
  });

  it("binds the pack to the enrolled tenant", () => {
    expect(
      acceptRulesPack(vector.envelope, context({ enrolledTenant: "other" })),
    ).toEqual({ ok: false, reason: "tenant_mismatch" });
    expect(
      acceptRulesPack(vector.envelope, context({ enrolledTenant: undefined })),
    ).toEqual({ ok: false, reason: "tenant_unknown" });
    const foreign = signed({ ...reference, tenantId: "tenant-b" });
    expect(acceptRulesPack(foreign, context())).toEqual({
      ok: false,
      reason: "tenant_mismatch",
    });
  });

  it("never goes back to an older version of the same pack", () => {
    const current = acceptRulesPack(vector.envelope, context());
    expect(current).toMatchObject({ ok: true, expired: false });
    const digest = current.ok ? current.digest : "";
    expect(
      acceptRulesPack(
        vector.envelope,
        context({ highest: { "acme-main": { version: 4, digest } } }),
      ),
    ).toEqual({ ok: false, reason: "version_downgrade" });
    expect(
      acceptRulesPack(
        vector.envelope,
        context({
          highest: { "acme-main": { version: 3, digest: "0".repeat(64) } },
        }),
      ),
    ).toEqual({ ok: false, reason: "version_conflict" });
    expect(
      acceptRulesPack(
        vector.envelope,
        context({ highest: { "acme-main": { version: 3, digest } } }),
      ),
    ).toMatchObject({ ok: true });
    // Another packId is unrelated to this history.
    expect(
      acceptRulesPack(
        vector.envelope,
        context({ highest: { other: { version: 99, digest } } }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("keeps an expired pack applied and flags it", () => {
    expect(
      acceptRulesPack(
        vector.envelope,
        context({ now: new Date("2027-09-01T00:00:00Z") }),
      ),
    ).toMatchObject({ ok: true, expired: true });
  });

  it("refuses a correctly signed but invalid pack", () => {
    const invalid = vectors.packs.find(
      (pack) => pack.name === "negative detected",
    )!.pack;
    const envelope = signed({ ...invalid, tenantId: TENANT });
    expect(acceptRulesPack(envelope, context())).toEqual({
      ok: false,
      reason: "invalid_pack",
      detail: "negative_detected",
    });
    const schema = signed({ ...reference, detectors: "none" });
    expect(acceptRulesPack(schema, context())).toEqual({
      ok: false,
      reason: "invalid_pack",
      detail: "schema",
    });
  });
});

describe("rules pack on disk", () => {
  let storage: string | undefined;
  afterEach(async () => {
    if (storage) await rm(storage, { recursive: true, force: true });
    storage = undefined;
  });

  async function freshStorage(): Promise<string> {
    storage = await mkdtemp(join(tmpdir(), "rules-pack-"));
    return storage;
  }

  it("re-verifies what it loads and needs the enrolled tenant", async () => {
    const directory = await freshStorage();
    expect(await loadAppliedRulesPack(directory, testKeys)).toEqual({
      status: "none",
    });
    await writeFile(rulesPackPath(directory), JSON.stringify(vector.envelope));
    expect(await loadAppliedRulesPack(directory, testKeys)).toEqual({
      status: "rejected",
      reason: "tenant_unknown",
    });
    await writeRulesPackState(directory, {
      ...EMPTY_RULES_PACK_STATE,
      tenantId: TENANT,
      tenantSource: "first_pack",
    });
    const applied = await loadAppliedRulesPack(
      directory,
      testKeys,
      new Date("2026-10-01T00:00:00Z"),
    );
    expect(applied).toMatchObject({ status: "applied", expired: false });
    // The same file with a build that has no authority key.
    expect(await loadAppliedRulesPack(directory, [])).toEqual({
      status: "rejected",
      reason: "no_authority_key",
    });
  });

  it("refuses a file edited after verification", async () => {
    const directory = await freshStorage();
    await writeRulesPackState(directory, {
      ...EMPTY_RULES_PACK_STATE,
      tenantId: TENANT,
    });
    await writeFile(
      rulesPackPath(directory),
      JSON.stringify({
        ...vector.envelope,
        payload: { ...reference, detectors: [] },
      }),
    );
    expect(await loadAppliedRulesPack(directory, testKeys)).toEqual({
      status: "rejected",
      reason: "invalid_signature",
    });
  });

  it("refuses malformed and oversize files without reading past the limit", async () => {
    const directory = await freshStorage();
    await writeFile(rulesPackPath(directory), "{not json");
    expect(await loadAppliedRulesPack(directory, testKeys)).toEqual({
      status: "rejected",
      reason: "malformed_envelope",
    });
    await writeFile(
      rulesPackPath(directory),
      " ".repeat(MAX_RULES_PACK_BYTES + 1),
    );
    expect(await loadAppliedRulesPack(directory, testKeys)).toEqual({
      status: "rejected",
      reason: "too_large",
    });
  });

  it("skips self-tests only for the exact digest already self-tested", async () => {
    const directory = await freshStorage();
    const invalid = vectors.packs.find(
      (pack) => pack.name === "negative detected",
    )!.pack;
    const envelope = signed({ ...invalid, tenantId: TENANT });
    const verified = verifyRulesPackEnvelope(envelope, testKeys);
    const digest = verified.ok ? verified.digest : "";
    await writeFile(rulesPackPath(directory), JSON.stringify(envelope));
    await writeRulesPackState(directory, {
      ...EMPTY_RULES_PACK_STATE,
      tenantId: TENANT,
      selfTestedDigest: "0".repeat(64),
    });
    expect(await loadAppliedRulesPack(directory, testKeys)).toMatchObject({
      status: "rejected",
      detail: "negative_detected",
    });
    await writeRulesPackState(directory, {
      ...EMPTY_RULES_PACK_STATE,
      tenantId: TENANT,
      selfTestedDigest: digest,
    });
    expect(await loadAppliedRulesPack(directory, testKeys)).toMatchObject({
      status: "applied",
    });
  });

  it("reads a malformed state as empty and keeps well-formed entries", async () => {
    const directory = await freshStorage();
    expect(await readRulesPackState(directory)).toEqual(EMPTY_RULES_PACK_STATE);
    await writeFile(join(directory, "rules-pack-state.json"), "[]");
    expect(await readRulesPackState(directory)).toEqual(EMPTY_RULES_PACK_STATE);
    await writeFile(
      join(directory, "rules-pack-state.json"),
      JSON.stringify({
        schemaVersion: 1,
        tenantId: TENANT,
        tenantSource: "register",
        highest: {
          good: { version: 2, digest: "a".repeat(64) },
          bad: { version: "2", digest: "x" },
        },
      }),
    );
    expect(await readRulesPackState(directory)).toEqual({
      schemaVersion: 1,
      tenantId: TENANT,
      tenantSource: "register",
      highest: { good: { version: 2, digest: "a".repeat(64) } },
    });
  });
});
