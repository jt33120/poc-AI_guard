import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalizePolicyPayload,
  observeCapOf,
  validateSignedPolicyDocument,
} from "../../packages/runner/src/index.js";

// Shared with the platform (tests/test_developer_policy_contract.py): the
// same vectors, and an envelope the platform signed byte for byte.
const vectors = JSON.parse(
  readFileSync(
    new URL("../../contracts/fixtures/policy-vectors.json", import.meta.url),
    "utf8",
  ),
) as {
  workstation: {
    valid: unknown[];
    invalid: Array<{ name: string; value: unknown }>;
  };
  signature: {
    canonical: string;
    envelope: {
      policy: Record<string, unknown>;
      publicKey: string;
      signature: string;
    };
  };
};

const base = {
  schemaVersion: 1,
  tenantId: "tenant-a",
  policyId: "team",
  version: 1,
  issuedAt: "2026-09-22T00:00:00Z",
  expiresAt: "2030-01-01T00:00:00Z",
  minRunnerVersion: "0.7.1",
  defaults: { unknownAction: "deny" },
  rules: [],
};

function signed(policy: Record<string, unknown>) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  const pinned = Buffer.from(jwk.x, "base64url").toString("base64");
  const signature = sign(
    null,
    Buffer.from(canonicalizePolicyPayload(policy)),
    privateKey,
  ).toString("base64");
  return { document: { policy, signature, publicKey: pinned }, pinned };
}

describe("organization cap on Avertir in the signed policy", () => {
  it("accepts every cap of the contract and reads it back", () => {
    for (const workstation of vectors.workstation.valid) {
      const { document, pinned } = signed({ ...base, workstation });
      const policy = validateSignedPolicyDocument(document, pinned, "0.7.1");
      expect(observeCapOf(policy)).toBe(
        (workstation as { observeMaxMinutes: number }).observeMaxMinutes,
      );
    }
  });

  it("refuses a signed policy whose cap is outside the contract", () => {
    for (const { name, value } of vectors.workstation.invalid) {
      const { document, pinned } = signed({ ...base, workstation: value });
      expect(
        () => validateSignedPolicyDocument(document, pinned, "0.7.1"),
        name,
      ).toThrow("invalid_policy_signature");
    }
  });

  it("has no cap without a policy or without the setting", () => {
    expect(observeCapOf(undefined)).toBeUndefined();
    const { document, pinned } = signed(base);
    expect(
      observeCapOf(validateSignedPolicyDocument(document, pinned, "0.7.1")),
    ).toBeUndefined();
  });

  it("verifies the envelope the platform signed, with its canonical bytes", () => {
    const { envelope, canonical } = vectors.signature;
    expect(canonicalizePolicyPayload(envelope.policy)).toBe(canonical);
    const policy = validateSignedPolicyDocument(
      envelope,
      envelope.publicKey,
      "0.7.1",
    );
    expect(policy.minRunnerVersion).toBe("0.7.1");
    expect(observeCapOf(policy)).toBe(60);
  });

  it("never lets an edited cap through the signature", () => {
    const { envelope } = vectors.signature;
    for (const observeMaxMinutes of [480, 0, 15]) {
      const tampered = {
        ...envelope,
        policy: { ...envelope.policy, workstation: { observeMaxMinutes } },
      };
      expect(() =>
        validateSignedPolicyDocument(tampered, envelope.publicKey, "0.7.1"),
      ).toThrow("invalid_policy_signature");
    }
    const uncapped = { ...envelope.policy };
    delete uncapped.workstation;
    expect(() =>
      validateSignedPolicyDocument(
        { ...envelope, policy: uncapped },
        envelope.publicKey,
        "0.7.1",
      ),
    ).toThrow("invalid_policy_signature");
  });

  it("is refused, never ignored, by a runner older than 0.7.1", () => {
    const { envelope } = vectors.signature;
    expect(() =>
      validateSignedPolicyDocument(envelope, envelope.publicKey, "0.7.0"),
    ).toThrow("runner_version_too_old");
  });

  it("names a newer runner before an unknown field", () => {
    // What 0.7.1 will answer to a future setting: the version it needs, not
    // a malformed policy.
    const { document, pinned } = signed({
      ...base,
      minRunnerVersion: "9.0.0",
      workstation: { observeMaxMinutes: 60, clipboard: "off" },
    });
    expect(() =>
      validateSignedPolicyDocument(document, pinned, "0.7.1"),
    ).toThrow("runner_version_too_old");
    const unsigned = { ...document, signature: "A".repeat(86) + "==" };
    expect(() =>
      validateSignedPolicyDocument(unsigned, pinned, "0.7.1"),
    ).toThrow("invalid_policy_signature");
  });
});
