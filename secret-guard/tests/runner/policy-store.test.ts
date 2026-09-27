import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { generateKeyPairSync, sign } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalizePolicyPayload,
  loadPolicy,
} from "../../packages/runner/src/index.js";

const policy = {
  schemaVersion: 1,
  tenantId: "tenant-a",
  policyId: "team",
  version: 1,
  issuedAt: "2026-09-22T00:00:00Z",
  expiresAt: "2030-01-01T00:00:00Z",
  defaults: { unknownAction: "deny" },
  rules: [],
};

describe("signed policy store", () => {
  it("only loads a valid envelope signed by the pinned key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const jwk = publicKey.export({ format: "jwk" }) as { x: string };
    const pinned = Buffer.from(jwk.x, "base64url").toString("base64");
    const signature = sign(
      null,
      Buffer.from(canonicalizePolicyPayload(policy)),
      privateKey,
    ).toString("base64");
    const directory = await mkdtemp(join(tmpdir(), "developer-guard-policy-"));
    const file = join(directory, "policy.json");
    try {
      await writeFile(
        file,
        JSON.stringify({ policy, signature, publicKey: pinned }),
      );
      await expect(loadPolicy(file, pinned)).resolves.toMatchObject({
        policyId: "team",
        tenantId: "tenant-a",
      });
      await expect(
        loadPolicy(file, Buffer.alloc(32, 1).toString("base64")),
      ).rejects.toThrow("policy_key_not_pinned");
      await writeFile(
        file,
        JSON.stringify({
          policy: { ...policy, version: 2 },
          signature,
          publicKey: pinned,
        }),
      );
      await expect(loadPolicy(file, pinned)).rejects.toThrow(
        "invalid_policy_signature",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects signed documents that exceed the strict contract", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const jwk = publicKey.export({ format: "jwk" }) as { x: string };
    const pinned = Buffer.from(jwk.x, "base64url").toString("base64");
    const directory = await mkdtemp(join(tmpdir(), "developer-guard-policy-"));
    const file = join(directory, "policy.json");
    try {
      for (const invalid of [
        { ...policy, schemaVersion: 2 },
        { ...policy, projectOverride: true },
        { ...policy, rules: [{ id: "UPPER", effect: "allow", match: {} }] },
      ]) {
        const signature = sign(
          null,
          Buffer.from(canonicalizePolicyPayload(invalid)),
          privateKey,
        ).toString("base64");
        await writeFile(
          file,
          JSON.stringify({ policy: invalid, signature, publicKey: pinned }),
        );
        await expect(loadPolicy(file, pinned)).rejects.toThrow(
          "invalid_policy_signature",
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses a policy requiring a newer runner", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const jwk = publicKey.export({ format: "jwk" }) as { x: string };
    const pinned = Buffer.from(jwk.x, "base64url").toString("base64");
    const required = { ...policy, minRunnerVersion: "9.0.0" };
    const signature = sign(
      null,
      Buffer.from(canonicalizePolicyPayload(required)),
      privateKey,
    ).toString("base64");
    const directory = await mkdtemp(join(tmpdir(), "developer-guard-policy-"));
    const file = join(directory, "policy.json");
    try {
      await writeFile(
        file,
        JSON.stringify({ policy: required, signature, publicKey: pinned }),
      );
      await expect(loadPolicy(file, pinned, "0.1.0")).rejects.toThrow(
        "runner_version_too_old",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
