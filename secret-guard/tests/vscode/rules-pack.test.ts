import {
  createPrivateKey,
  createPublicKey,
  sign,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorityKeyId,
  canonicalRulesPack,
  parseAuthorityKeys,
  readRulesPackState,
  rulesPackPath,
  rulesPackStatePath,
} from "../../packages/runner/src/index.js";
import { customFindingFields } from "../../packages/vscode/src/gateway-client.js";
import { dashboardHtml } from "../../packages/vscode/src/dashboard.js";
import {
  fetchRulesPack,
  forgetEnrollment,
  readRulesPackSnapshot,
  syncRulesPack,
} from "../../packages/vscode/src/rules-pack-sync.js";
import {
  rulesPackView,
  shortDate,
  type RulesPackView,
} from "../../packages/vscode/src/rules-pack-view.js";
import type { HookHealth } from "../../packages/vscode/src/hook-manager.js";

const vectors = JSON.parse(
  readFileSync(
    new URL(
      "../../contracts/fixtures/rules-pack-vectors.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  signature: {
    seedBase64: string;
    publicKeyBase64: string;
    envelope: { payload: Record<string, unknown> };
  };
};
const TENANT = "00000000-0000-4000-8000-000000000001";
const keys = parseAuthorityKeys(vectors.signature.publicKeyBase64);
const privateKey: KeyObject = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(vectors.signature.seedBase64, "base64"),
  ]),
  format: "der",
  type: "pkcs8",
});
const reference = vectors.signature.envelope.payload;
const NOW = new Date("2026-10-01T00:00:00Z");

function envelope(
  payload: Record<string, unknown>,
  key: KeyObject = privateKey,
): Record<string, unknown> {
  const jwk = createPublicKey(key).export({ format: "jwk" }) as { x: string };
  return {
    payload,
    keyId: authorityKeyId(Buffer.from(jwk.x, "base64url").toString("base64")),
    signature: sign(
      null,
      Buffer.from(canonicalRulesPack(payload), "utf8"),
      key,
    ).toString("base64"),
  };
}

let storage: string | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  if (storage) await rm(storage, { recursive: true, force: true });
  storage = undefined;
});

async function freshStorage(): Promise<string> {
  storage = await mkdtemp(join(tmpdir(), "rules-sync-"));
  return storage;
}

function serving(value: unknown): { fetchPack: () => Promise<unknown> } {
  return { fetchPack: () => Promise.resolve(value) };
}

async function view(directory: string, now = NOW): Promise<RulesPackView> {
  return rulesPackView(await readRulesPackSnapshot(directory, keys, now));
}

describe("rules pack synchronisation", () => {
  it("applies the first pack and pins its tenant", async () => {
    const directory = await freshStorage();
    const outcome = await syncRulesPack(
      "https://xsom.test",
      "token",
      directory,
      {
        keys,
        now: NOW,
        ...serving(envelope(reference)),
      },
    );
    expect(outcome).toMatchObject({ outcome: "applied" });
    expect((await stat(rulesPackPath(directory))).mode & 0o777).toBe(0o600);
    expect((await stat(rulesPackStatePath(directory))).mode & 0o777).toBe(
      0o600,
    );
    const state = await readRulesPackState(directory);
    expect(state).toMatchObject({
      tenantId: TENANT,
      tenantSource: "first_pack",
      highest: { "acme-main": { version: 3 } },
      lastSync: { outcome: "applied" },
    });
    expect(state.selfTestedDigest).toBe(
      outcome.outcome === "applied" ? outcome.digest : "",
    );
    expect(await view(directory)).toMatchObject({
      state: "active",
      tone: "ok",
      line: "Réglage xSOM · v3 · 3 règles · jusqu’au 01/09/2027",
      packId: "acme-main",
      version: 3,
    });
  });

  it("refuses a pack for another tenant than the one stated at registration", async () => {
    const directory = await freshStorage();
    expect(
      await syncRulesPack("https://xsom.test", "token", directory, {
        keys,
        now: NOW,
        enrolledTenant: { id: "tenant-b", source: "register" },
        ...serving(envelope(reference)),
      }),
    ).toEqual({ outcome: "rejected", reason: "tenant_mismatch" });
    expect(await view(directory)).toMatchObject({
      state: "rejected",
      tone: "danger",
      line: "Réglage refusé : destiné à une autre organisation",
      reason: "rules_pack_rejected",
    });
  });

  it("keeps the verified pack when an update is forged, older or unreachable", async () => {
    const directory = await freshStorage();
    await syncRulesPack("https://xsom.test", "token", directory, {
      keys,
      now: NOW,
      ...serving(envelope({ ...reference, version: 4 })),
    });
    const forged = {
      ...envelope({ ...reference, version: 5 }),
      signature: Buffer.alloc(64, 1).toString("base64"),
    };
    expect(
      await syncRulesPack("https://xsom.test", "token", directory, {
        keys,
        now: NOW,
        ...serving(forged),
      }),
    ).toEqual({ outcome: "rejected", reason: "invalid_signature" });
    expect(await view(directory)).toMatchObject({
      state: "active",
      tone: "warn",
      version: 4,
      line: "Réglage xSOM · v4 · 3 règles · jusqu’au 01/09/2027 · mise à jour : signature invalide",
      reason: "rules_pack_rejected",
    });
    expect(
      await syncRulesPack("https://xsom.test", "token", directory, {
        keys,
        now: NOW,
        ...serving(envelope(reference)),
      }),
    ).toEqual({ outcome: "rejected", reason: "version_downgrade" });
    expect(
      await syncRulesPack("https://xsom.test", "token", directory, {
        keys,
        now: NOW,
        fetchPack: () => Promise.reject(new Error("offline")),
      }),
    ).toEqual({ outcome: "error" });
    expect(await view(directory)).toMatchObject({
      state: "active",
      version: 4,
      line: "Réglage xSOM · v4 · 3 règles · jusqu’au 01/09/2027 · mise à jour : synchronisation impossible",
    });
  });

  it("never replaces a newer pack applied meanwhile by another window", async () => {
    const directory = await freshStorage();
    let release: () => void = () => undefined;
    const slow = syncRulesPack("https://xsom.test", "token", directory, {
      keys,
      now: NOW,
      fetchPack: () =>
        new Promise((resolve) => {
          release = () => {
            resolve(envelope(reference));
          };
        }),
    });
    await syncRulesPack("https://xsom.test", "token", directory, {
      keys,
      now: NOW,
      ...serving(envelope({ ...reference, version: 4 })),
    });
    release();
    await slow;
    expect(await view(directory)).toMatchObject({
      state: "active",
      version: 4,
    });
    expect(
      (await readRulesPackState(directory)).highest["acme-main"]?.version,
    ).toBe(4);
  });

  it("goes back to the built-in rules when the tenant has no tuning any more", async () => {
    const directory = await freshStorage();
    await syncRulesPack("https://xsom.test", "token", directory, {
      keys,
      now: NOW,
      ...serving(envelope(reference)),
    });
    expect(
      await syncRulesPack("https://xsom.test", "token", directory, {
        keys,
        now: NOW,
        ...serving(null),
      }),
    ).toEqual({ outcome: "none" });
    await expect(stat(rulesPackPath(directory))).rejects.toThrow();
    expect(await view(directory)).toMatchObject({
      state: "none",
      line: "Aucun réglage sur mesure",
      offerRequest: false,
    });
    // History survives: the old version cannot come back.
    expect(
      (await readRulesPackState(directory)).highest["acme-main"]?.version,
    ).toBe(3);
  });

  it("flags an expired pack but keeps applying it", async () => {
    const directory = await freshStorage();
    await syncRulesPack("https://xsom.test", "token", directory, {
      keys,
      now: NOW,
      ...serving(envelope(reference)),
    });
    const later = new Date("2027-09-02T00:00:00Z");
    const snapshot = await readRulesPackSnapshot(directory, keys, later);
    expect(snapshot.applied.status).toBe("applied");
    expect(rulesPackView(snapshot)).toMatchObject({
      state: "expired",
      tone: "warn",
      line: "Réglage xSOM · v3 · 3 règles · expiré le 01/09/2027",
      reason: "rules_pack_expired",
    });
  });

  it("says when this build cannot verify any pack", async () => {
    const directory = await freshStorage();
    expect(
      await syncRulesPack("https://xsom.test", "token", directory, {
        keys: [],
        now: NOW,
        ...serving(envelope(reference)),
      }),
    ).toEqual({ outcome: "rejected", reason: "no_authority_key" });
    expect(
      rulesPackView(await readRulesPackSnapshot(directory, [], NOW)),
    ).toMatchObject({
      state: "no_authority_key",
      line: "Réglage indisponible : build sans clé xSOM",
    });
  });

  it("forgets the enrollment on disconnection but keeps the version history", async () => {
    const directory = await freshStorage();
    await syncRulesPack("https://xsom.test", "token", directory, {
      keys,
      now: NOW,
      ...serving(envelope(reference)),
    });
    await forgetEnrollment(directory);
    expect(await readRulesPackState(directory)).toMatchObject({
      highest: { "acme-main": { version: 3 } },
    });
    expect((await readRulesPackState(directory)).tenantId).toBeUndefined();
    expect(await view(directory)).toMatchObject({
      state: "none",
      offerRequest: true,
    });
  });
});

describe("rules pack route", () => {
  function stubResponse(body: string, status = 200): void {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("X-Gateway-Token")).toBe("t");
        return Promise.resolve(new Response(body, { status }));
      }),
    );
  }

  it("reads the envelope or null, with the workstation token", async () => {
    stubResponse(JSON.stringify({ rulesPack: null }));
    await expect(fetchRulesPack("https://xsom.test", "t")).resolves.toBeNull();
    stubResponse(JSON.stringify({ rulesPack: { payload: {} } }));
    await expect(fetchRulesPack("https://xsom.test", "t")).resolves.toEqual({
      payload: {},
    });
  });

  it("fails on errors, invalid bodies and oversize responses", async () => {
    stubResponse("{}", 404);
    await expect(fetchRulesPack("https://xsom.test", "t")).rejects.toThrow(
      "gateway_http_404",
    );
    stubResponse(JSON.stringify({ other: 1 }));
    await expect(fetchRulesPack("https://xsom.test", "t")).rejects.toThrow(
      "rules_pack_response_invalid",
    );
    stubResponse(" ".repeat(4 * 1024 * 1024 + 100));
    await expect(fetchRulesPack("https://xsom.test", "t")).rejects.toThrow(
      "rules_pack_too_large",
    );
    await expect(fetchRulesPack("http://xsom.test", "t")).rejects.toThrow();
  });
});

describe("rules pack presentation", () => {
  it("offers a tuning request to Local users only", () => {
    const local = rulesPackView({
      applied: { status: "none" },
      enrolled: false,
      authorityKeys: 1,
    });
    expect(local).toMatchObject({
      state: "none",
      line: "Aucun réglage sur mesure",
      offerRequest: true,
    });
    expect(local.detail).toContain("xSOM calibre et signe");
    expect(
      rulesPackView({
        applied: { status: "none" },
        enrolled: true,
        authorityKeys: 1,
        lastSync: {
          at: NOW.toISOString(),
          outcome: "error",
          reason: "sync_failed",
        },
      }),
    ).toMatchObject({
      state: "sync_error",
      line: "Réglage xSOM : synchronisation impossible",
      offerRequest: false,
    });
  });

  it("formats dates from the signed timestamp", () => {
    expect(shortDate("2027-09-01T00:00:00Z")).toBe("01/09/2027");
  });

  it("lists custom detections by detector id only", () => {
    const finding = (detectorId: string) => ({ custom: { detectorId } });
    expect(customFindingFields([{}])).toEqual({});
    const many = Array.from({ length: 30 }, (_, index) =>
      finding(`d${String(index % 25)}`),
    );
    const fields = customFindingFields([...many, {}]);
    expect(fields.custom_findings).toBe(30);
    expect(fields.custom_detector_ids).toHaveLength(20);
    expect(new Set(fields.custom_detector_ids).size).toBe(20);
  });

  it("shows the tuning in the protection centre, escaped", () => {
    const health: HookHealth = {
      state: "active",
      reason: "local_canaries_verified",
      hosts: [],
    };
    const html = dashboardHtml(health, "redact", "nonce", false, undefined, {
      state: "rejected",
      tone: "danger",
      line: "x",
      title: "Réglage <refusé>",
      detail: "raison & détail",
      offerRequest: false,
    });
    expect(html).toContain("Règles sur mesure");
    expect(html).toContain("Réglage &lt;refusé&gt;");
    expect(html).toContain("raison &amp; détail");
    expect(html).not.toContain("secretGuard.requestRulesPack");
    const local = dashboardHtml(
      health,
      "redact",
      "nonce",
      false,
      undefined,
      rulesPackView({
        applied: { status: "none" },
        enrolled: false,
        authorityKeys: 1,
      }),
    );
    expect(local).toContain(
      '<a href="command:secretGuard.requestRulesPack">Demander un réglage à xSOM →</a>',
    );
  });
});

it("stores the envelope exactly as verified", async () => {
  const directory = await freshStorage();
  const signed = envelope(reference);
  await syncRulesPack("https://xsom.test", "token", directory, {
    keys,
    now: NOW,
    ...serving(signed),
  });
  expect(JSON.parse(await readFile(rulesPackPath(directory), "utf8"))).toEqual(
    signed,
  );
});
