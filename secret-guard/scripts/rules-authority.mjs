// Build-time handling of the xSOM rules authority keys. The public keys come
// from the environment of the build (XSOM_RULES_AUTHORITY_KEYS, a
// comma-separated list of base64 raw Ed25519 public keys, several during a
// rotation) and are compiled into the bundles; the private seed never is.
import { createHash } from "node:crypto";

/**
 * Public key of the contract test vectors. Its seed is published in
 * contracts/fixtures/rules-pack-vectors.json: anyone can sign with it, so a
 * build that trusts it must never leave the test suite.
 */
export const TEST_AUTHORITY_PUBLIC_KEYS = Object.freeze([
  "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=",
]);

export function authorityKeyId(publicKey) {
  return createHash("sha256")
    .update(Buffer.from(publicKey, "base64"))
    .digest("hex");
}

/**
 * Validated keys for this build. Throws on a malformed entry, and on the
 * public test key unless XSOM_RULES_TEST_BUILD=1 marks a test-only build.
 */
export function readAuthorityKeys(env = process.env) {
  const keys = (env.XSOM_RULES_AUTHORITY_KEYS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  for (const key of keys) {
    if (
      !/^[A-Za-z0-9+/]{43}=$/u.test(key) ||
      Buffer.from(key, "base64").length !== 32
    )
      throw new Error(
        "XSOM_RULES_AUTHORITY_KEYS: each entry must be a base64 raw Ed25519 public key (32 bytes).",
      );
    if (
      TEST_AUTHORITY_PUBLIC_KEYS.includes(key) &&
      env.XSOM_RULES_TEST_BUILD !== "1"
    )
      throw new Error(
        "XSOM_RULES_AUTHORITY_KEYS contains the public TEST key of the contract vectors; it is only allowed in a test build (XSOM_RULES_TEST_BUILD=1).",
      );
  }
  if (new Set(keys).size !== keys.length)
    throw new Error("XSOM_RULES_AUTHORITY_KEYS lists a key twice.");
  return keys;
}
