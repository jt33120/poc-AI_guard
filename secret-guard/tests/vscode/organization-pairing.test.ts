import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  beginPairing,
  confirmationUrl,
  pollPairing,
  cancelPairing,
} from "../../packages/vscode/src/organization-pairing.js";

afterEach(() => {
  vi.unstubAllGlobals();
});
const registration = {
  installation_id: randomUUID(),
  platform: "darwin",
  extension_version: "0.6.2",
  mode: "block" as const,
};
function response(body: unknown) {
  return new Response(JSON.stringify(body));
}

describe("organization device authorization", () => {
  it("sends only a credential hash at initiation and no credential in the browser URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        code: "ABCDE-23456",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        endpoint: "https://api.example.test",
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const pairing = await beginPairing(
      "https://console.example.test",
      registration,
    );
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
      ...registration,
      credential_hash: createHash("sha256")
        .update(pairing.credential)
        .digest("hex"),
    });
    expect(confirmationUrl(pairing)).toBe(
      "https://console.example.test/extensions/connect?code=ABCDE-23456",
    );
    expect(confirmationUrl(pairing)).not.toContain(pairing.credential);
    fetcher.mockResolvedValueOnce(response({ status: "pending" }));
    expect(await pollPairing(pairing)).toBeUndefined();
    fetcher.mockResolvedValueOnce(
      response({
        status: "approved",
        device_id: registration.installation_id,
        organization: { name: "xSOM test" },
      }),
    );
    expect(await pollPairing(pairing)).toBe("xSOM test");
    expect(fetcher.mock.calls[1]?.[1].headers["X-Gateway-Token"]).toBe(
      pairing.credential,
    );
    fetcher.mockResolvedValueOnce(response({ cancelled: true }));
    await cancelPairing(pairing);
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe(
      "https://console.example.test/api/enrollment/cancel",
    );
  });
  it("rejects expired codes, wrong installations and unsafe service responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        code: "ABCDE-23456",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        endpoint: "https://api.example.test",
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const pairing = await beginPairing(
      "https://console.example.test",
      registration,
    );
    fetcher.mockResolvedValueOnce(
      response({
        status: "approved",
        device_id: randomUUID(),
        organization: { name: "Other" },
      }),
    );
    await expect(pollPairing(pairing)).rejects.toThrow(
      "invalid_pairing_confirmation",
    );
    await expect(
      pollPairing({ ...pairing, expiresAt: Date.now() - 1 }),
    ).rejects.toThrow("pairing_expired");
    await expect(
      beginPairing("http://untrusted.example.test", registration),
    ).rejects.toThrow();
    fetcher.mockResolvedValueOnce(
      response({
        code: "ABCDE-23456",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        endpoint: "http://untrusted.example.test",
      }),
    );
    await expect(
      beginPairing("https://console.example.test", registration),
    ).rejects.toThrow();
  });
});
