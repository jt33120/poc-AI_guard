import { createPublicKey, verify } from "node:crypto";

export function canonicalizePolicyPayload(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalizePolicyPayload).join(",")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalizePolicyPayload(object[key])}`,
    )
    .join(",")}}`;
}

function base64Url(value: string): string {
  return Buffer.from(value, "base64").toString("base64url");
}

export function verifyPolicySignature(
  payload: Record<string, unknown>,
  signatureBase64: string,
  publicKeyBase64: string,
): boolean {
  try {
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: base64Url(publicKeyBase64) },
      format: "jwk",
    });
    return verify(
      null,
      Buffer.from(canonicalizePolicyPayload(payload)),
      key,
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}
