import { MAX_INPUT_BYTES } from "./types.js";

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Returns the bytes as text only when the scanner can cover all of them:
 * valid UTF-8, no NUL byte (binary formats) and within the scan limit.
 * Anything else is undefined and must be treated as an incomplete scan.
 */
export function decodeScannableText(bytes: Uint8Array): string | undefined {
  if (bytes.byteLength > MAX_INPUT_BYTES || bytes.includes(0)) return undefined;
  try {
    return STRICT_UTF8.decode(bytes);
  } catch {
    return undefined;
  }
}
