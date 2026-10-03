import { createHash, randomBytes } from "node:crypto";
import { gatewayJson, gatewayUrl } from "./gateway-client.js";

export interface PendingPairing {
  consoleUrl: string;
  endpoint: string;
  credential: string;
  code: string;
  expiresAt: number;
  installation: string;
}

export async function beginPairing(
  consoleUrl: string,
  registration: {
    installation_id: string;
    platform: string;
    extension_version: string;
    mode: "block" | "redact" | "observe";
  },
): Promise<PendingPairing> {
  const origin = new URL(gatewayUrl(consoleUrl));
  if (origin.pathname !== "/") throw new Error("console_origin_required");
  const base = origin.origin;
  const credential = `xsg_${randomBytes(32).toString("base64url")}`;
  const response = (await gatewayJson(base, "", "/api/enrollment/start", {
    ...registration,
    credential_hash: createHash("sha256").update(credential).digest("hex"),
  })) as { code?: unknown; expires_at?: unknown; endpoint?: unknown };
  if (
    typeof response.code !== "string" ||
    !/^[A-Z2-9]{5}-[A-Z2-9]{5}$/u.test(response.code) ||
    typeof response.expires_at !== "string" ||
    typeof response.endpoint !== "string"
  )
    throw new Error("invalid_pairing_response");
  const expiresAt = Date.parse(response.expires_at);
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + 660_000
  )
    throw new Error("invalid_pairing_expiry");
  return {
    consoleUrl: base,
    endpoint: gatewayUrl(response.endpoint),
    credential,
    code: response.code,
    expiresAt,
    installation: registration.installation_id,
  };
}

export function confirmationUrl(pairing: PendingPairing): string {
  const url = new URL("/extensions/connect", pairing.consoleUrl);
  url.searchParams.set("code", pairing.code);
  return url.href;
}

export async function pollPairing(
  pairing: PendingPairing,
): Promise<string | undefined> {
  if (Date.now() >= pairing.expiresAt) throw new Error("pairing_expired");
  const response = (await gatewayJson(
    pairing.consoleUrl,
    pairing.credential,
    "/api/enrollment/status",
    {},
  )) as {
    status?: unknown;
    device_id?: unknown;
    organization?: { name?: unknown };
  };
  if (response.status === "pending") return undefined;
  if (
    response.status !== "approved" ||
    response.device_id !== pairing.installation ||
    typeof response.organization?.name !== "string" ||
    response.organization.name.length > 200
  )
    throw new Error("invalid_pairing_confirmation");
  return response.organization.name;
}

export async function cancelPairing(pairing: PendingPairing): Promise<void> {
  await gatewayJson(
    pairing.consoleUrl,
    pairing.credential,
    "/api/enrollment/cancel",
    {},
  );
}
