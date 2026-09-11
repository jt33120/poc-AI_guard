const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export const MAX_DECODE_ATTEMPTS = 128;
export const MAX_DECODED_BYTES = 262_144;

export interface DecodeBudget {
  candidates: number;
  bytes: number;
  exhausted: boolean;
}

function sextet(character: string): number {
  return BASE64_ALPHABET.indexOf(character);
}

/** Strict, bounded Base64/Base64URL decoder for local ASCII/UTF-8 inspection. */
export function decodeBase64(
  value: string,
  maxDecodedBytes = 16_384,
): string | null {
  let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1)
    return null;
  normalized += "=".repeat((4 - (normalized.length % 4)) % 4);
  const bytes: number[] = [];

  for (let index = 0; index < normalized.length; index += 4) {
    const a = sextet(normalized[index] ?? "");
    const b = sextet(normalized[index + 1] ?? "");
    const cChar = normalized[index + 2] ?? "=";
    const dChar = normalized[index + 3] ?? "=";
    const c = cChar === "=" ? 0 : sextet(cChar);
    const d = dChar === "=" ? 0 : sextet(dChar);
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;

    bytes.push((a << 2) | (b >> 4));
    if (cChar !== "=") bytes.push(((b & 15) << 4) | (c >> 2));
    if (dChar !== "=") bytes.push(((c & 3) << 6) | d);
    if (bytes.length > maxDecodedBytes) return null;
  }

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(bytes),
    );
    if (decoded.includes("\u0000")) return null;
    const printable = [...decoded].filter(
      (character) =>
        character === "\n" ||
        character === "\r" ||
        character === "\t" ||
        character >= " ",
    ).length;
    return decoded.length > 0 && printable / [...decoded].length >= 0.9
      ? decoded
      : null;
  } catch {
    return null;
  }
}

/** Decode while charging a scan-wide budget before any temporary byte buffer is built. */
export function decodeBase64Budgeted(
  value: string,
  maxDecodedBytes: number,
  budget: DecodeBudget,
): string | null {
  if (budget.exhausted) return null;
  budget.candidates += 1;
  budget.bytes += Math.min(
    Math.ceil((value.length * 3) / 4),
    maxDecodedBytes + 1,
  );
  if (
    budget.candidates > MAX_DECODE_ATTEMPTS ||
    budget.bytes > MAX_DECODED_BYTES
  ) {
    budget.exhausted = true;
    return null;
  }
  return decodeBase64(value, maxDecodedBytes);
}

export function isStructurallyValidJwt(
  value: string,
  budget?: DecodeBudget,
): boolean {
  const parts = value.split(".");
  if (parts.length !== 3 || (parts[2]?.length ?? 0) < 8) return false;
  try {
    const decode = (part: string, maximum: number): string | null =>
      budget === undefined
        ? decodeBase64(part, maximum)
        : decodeBase64Budgeted(part, maximum, budget);
    const header = JSON.parse(
      decode(parts[0] ?? "", 4_096) ?? "null",
    ) as unknown;
    const payload = JSON.parse(
      decode(parts[1] ?? "", 16_384) ?? "null",
    ) as unknown;
    return (
      typeof header === "object" &&
      header !== null &&
      !Array.isArray(header) &&
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload)
    );
  } catch {
    return false;
  }
}
