import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalizePolicyPayload } from "../../packages/runner/src/index.js";

import {
  policyKeyPath,
  policyPath,
  syncManagedPolicy,
  verifiedObserveCap,
  verifiedPolicyTenant,
} from "../../packages/vscode/src/team/enrollment.js";

const PUBLIC_KEY_A = "MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

let storage = "";
afterEach(async () => {
  vi.unstubAllGlobals();
  if (storage) await rm(storage, { recursive: true, force: true });
  storage = "";
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function signedEnvelope(policy: Record<string, unknown>) {
  const pair = generateKeyPairSync("ed25519");
  const jwk = pair.publicKey.export({ format: "jwk" });
  if (typeof jwk.x !== "string") throw new Error("missing public key");
  const publicKey = Buffer.from(jwk.x, "base64url").toString("base64");
  return {
    policy,
    publicKey,
    keyId: "test-key",
    signature: sign(
      null,
      Buffer.from(canonicalizePolicyPayload(policy)),
      pair.privateKey,
    ).toString("base64"),
  };
}

function validPolicy(version: number, extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    tenantId: "tenant-a",
    policyId: "team",
    version,
    issuedAt: "2026-09-22T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
    defaults: { unknownAction: "deny" },
    rules: [],
    ...extra,
  };
}

describe("managed policy enrollment", () => {
  it("retains the pinned key when an assignment is removed", async () => {
    storage = await mkdtemp(join(tmpdir(), "developer-guard-enrollment-"));
    await Promise.all([
      writeFile(policyKeyPath(storage), `${PUBLIC_KEY_A}\n`),
      writeFile(policyPath(storage), "{}"),
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, 404)));

    await expect(
      syncManagedPolicy("http://localhost:8080", "token", storage),
    ).resolves.toBe("none");
    await expect(readFile(policyKeyPath(storage), "utf8")).resolves.toBe(
      `${PUBLIC_KEY_A}\n`,
    );
    await expect(readFile(policyPath(storage), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects a validly-shaped policy from a replacement key", async () => {
    storage = await mkdtemp(join(tmpdir(), "developer-guard-enrollment-"));
    await writeFile(policyKeyPath(storage), `${PUBLIC_KEY_A}\n`);
    const replacement = signedEnvelope({});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          ...replacement,
          keyId: "new",
        }),
      ),
    );

    await expect(
      syncManagedPolicy("http://localhost:8080", "token", storage),
    ).rejects.toThrow("unexpected_policy_key_rotation");
  });

  it("refuses a signed downgrade and preserves the cached policy while offline", async () => {
    storage = await mkdtemp(join(tmpdir(), "developer-guard-enrollment-"));
    const currentPolicy = validPolicy(2);
    const downgradedPolicy = validPolicy(1);
    const pair = generateKeyPairSync("ed25519");
    const jwk = pair.publicKey.export({ format: "jwk" });
    if (typeof jwk.x !== "string") throw new Error("missing public key");
    const pinned = Buffer.from(jwk.x, "base64url").toString("base64");
    const envelope = (policy: Record<string, unknown>) => ({
      policy,
      publicKey: pinned,
      keyId: "same-key",
      signature: sign(
        null,
        Buffer.from(canonicalizePolicyPayload(policy)),
        pair.privateKey,
      ).toString("base64"),
    });
    const cached = envelope(currentPolicy);
    await Promise.all([
      writeFile(policyKeyPath(storage), `${pinned}\n`),
      writeFile(policyPath(storage), JSON.stringify(cached)),
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(envelope(downgradedPolicy))),
    );
    await expect(
      syncManagedPolicy("http://localhost:8080", "token", storage),
    ).rejects.toThrow("policy_version_downgrade");
    await expect(readFile(policyPath(storage), "utf8")).resolves.toBe(
      JSON.stringify(cached),
    );

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(
      syncManagedPolicy("http://localhost:8080", "token", storage),
    ).rejects.toThrow("offline");
    await expect(readFile(policyPath(storage), "utf8")).resolves.toBe(
      JSON.stringify(cached),
    );
  });

  it("rejects an expired policy and a policy requiring a newer runner", async () => {
    storage = await mkdtemp(join(tmpdir(), "developer-guard-enrollment-"));
    for (const envelope of [
      signedEnvelope(
        validPolicy(1, {
          issuedAt: "2020-01-01T00:00:00Z",
          expiresAt: "2020-01-02T00:00:00Z",
        }),
      ),
      signedEnvelope(validPolicy(1, { minRunnerVersion: "9.0.0" })),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(envelope)));
      await expect(
        syncManagedPolicy("http://localhost:8080", "token", storage, "0.6.0"),
      ).rejects.toThrow(/policy_not_current|runner_version_too_old/u);
      await rm(storage, { recursive: true, force: true });
      storage = await mkdtemp(join(tmpdir(), "developer-guard-enrollment-"));
    }
  });

  it("states the enrolled tenant only from a re-verified signed policy", async () => {
    storage = await mkdtemp(join(tmpdir(), "developer-guard-enrollment-"));
    expect(await verifiedPolicyTenant(storage)).toBeUndefined();
    const envelope = signedEnvelope(validPolicy(1));
    await writeFile(policyKeyPath(storage), `${envelope.publicKey}\n`);
    await writeFile(policyPath(storage), JSON.stringify(envelope));
    expect(await verifiedPolicyTenant(storage)).toBe("tenant-a");
    // Editing the stored tenant breaks the signature: no tenant at all.
    await writeFile(
      policyPath(storage),
      JSON.stringify({
        ...envelope,
        policy: { ...envelope.policy, tenantId: "tenant-b" },
      }),
    );
    expect(await verifiedPolicyTenant(storage)).toBeUndefined();
  });

  it("reads the organization's Avertir cap only from a re-verified policy", async () => {
    storage = await mkdtemp(join(tmpdir(), "developer-guard-enrollment-"));
    expect(await verifiedObserveCap(storage, "0.7.1")).toBeUndefined();
    const envelope = signedEnvelope(
      validPolicy(1, {
        minRunnerVersion: "0.7.1",
        workstation: { observeMaxMinutes: 60 },
      }),
    );
    await writeFile(policyPath(storage), JSON.stringify(envelope));
    // Not pinned yet: nothing is read from the file.
    expect(await verifiedObserveCap(storage, "0.7.1")).toBeUndefined();
    await writeFile(policyKeyPath(storage), `${envelope.publicKey}\n`);
    expect(await verifiedObserveCap(storage, "0.7.1")).toBe(60);
    // A runner too old for the policy reads no cap from it (and the hook
    // refuses the managed actions instead).
    expect(await verifiedObserveCap(storage, "0.7.0")).toBeUndefined();
    // Loosening the stored cap by hand breaks the signature.
    await writeFile(
      policyPath(storage),
      JSON.stringify({
        ...envelope,
        policy: { ...envelope.policy, workstation: { observeMaxMinutes: 480 } },
      }),
    );
    expect(await verifiedObserveCap(storage, "0.7.1")).toBeUndefined();
    const forbidding = signedEnvelope(
      validPolicy(2, {
        minRunnerVersion: "0.7.1",
        workstation: { observeMaxMinutes: 0 },
      }),
    );
    await writeFile(policyKeyPath(storage), `${forbidding.publicKey}\n`);
    await writeFile(policyPath(storage), JSON.stringify(forbidding));
    expect(await verifiedObserveCap(storage, "0.7.1")).toBe(0);
  });
});
