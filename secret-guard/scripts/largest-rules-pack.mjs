// The largest rules pack the contract allows, generated deterministically for
// the performance gate and the hostile tests: 200 detectors (196 patterns of
// four shapes, 4 terms detectors) and 20 000 digests, 196 positives and 200
// negatives of 2 000 characters. Synthetic data only.

import { normalizeTerm, termDigest } from "@xsom/secret-guard-core";

const SHAPES = 4;
const TERMS_DETECTORS = 4;
const DIGESTS_PER_TERMS = 5_000;
const PATTERN_DETECTORS = 200 - TERMS_DETECTORS;
const NEGATIVE_LINE =
  "Explain the authorization flow without changing any files. ";

function salt(index) {
  const bytes = Uint8Array.from(
    { length: 16 },
    (_, at) => (at * 7 + index * 31) & 0xff,
  );
  return Buffer.from(bytes).toString("base64");
}

function patternDetector(index) {
  switch (index % SHAPES) {
    case 0:
      return [
        {
          id: `shape-a.${index}`,
          label: `Identifiant client ${index}`,
          category: "customer_data",
          action: "block",
          match: { type: "pattern", pattern: `CLI${index}-[0-9]{8}` },
        },
        `Le client CLI${index}-00421337 a appelé.`,
      ];
    case 1:
      return [
        {
          id: `shape-b.${index}`,
          label: `Base interne ${index}`,
          category: "internal_infra",
          action: "warn",
          match: {
            type: "pattern",
            pattern: `acme${index}-(?:prod|staging)-db[0-9]{1,2}`,
            caseInsensitive: true,
          },
        },
        `connect to ACME${index}-Prod-DB7 then stop`,
      ];
    case 2:
      return [
        {
          id: `shape-c.${index}`,
          label: `SIRET client ${index}`,
          category: "customer_data",
          action: "warn",
          match: { type: "pattern", pattern: "[0-9]{14}" },
          context: { keywords: [`siret${index}`], window: 24 },
        },
        `SIRET${index} 55210055400013 facture jointe`,
      ];
    default:
      return [
        {
          id: `shape-d.${index}`,
          label: `Jeton interne ${index}`,
          category: "credential",
          action: "block",
          match: {
            type: "pattern",
            pattern: `tok${index}_[A-Za-z0-9]{16}`,
            minEntropyTenths: 30,
          },
        },
        `utilise tok${index}_x7Kq9Lm2Pz4Rt8Vw ici`,
      ];
  }
}

function termsDetector(index, sharedSalt) {
  const encodedSalt = salt(sharedSalt ? 0 : index);
  const saltBytes = Uint8Array.from(Buffer.from(encodedSalt, "base64"));
  const digests = Array.from({ length: DIGESTS_PER_TERMS }, (_, term) =>
    termDigest(saltBytes, normalizeTerm(`nomcode${index}x${term}`)),
  );
  return {
    id: `terms.${index}`,
    label: `Noms de code ${index}`,
    category: "project",
    action: "block",
    match: { type: "terms", salt: encodedSalt, digests, maxWords: 4 },
  };
}

/**
 * A valid, unsigned payload of the maximum size. `sharedSalt` gives the four
 * terms detectors one salt, as the platform is advised to do: one hashing
 * pass instead of four.
 */
export function largestRulesPack({ sharedSalt = false } = {}) {
  const detectors = [];
  const positives = [];
  for (let index = 0; index < PATTERN_DETECTORS; index += 1) {
    const [detector, positive] = patternDetector(index);
    detectors.push(detector);
    positives.push({ detector: detector.id, text: positive });
  }
  for (let index = 0; index < TERMS_DETECTORS; index += 1)
    detectors.push(termsDetector(index, sharedSalt));
  const negative = NEGATIVE_LINE.repeat(
    Math.ceil(2_000 / NEGATIVE_LINE.length),
  ).slice(0, 2_000);
  return {
    schemaVersion: 1,
    kind: "xsom.secret-guard.rules-pack",
    packId: "benchmark-largest",
    tenantId: "00000000-0000-4000-8000-000000000001",
    version: 1,
    issuedAt: "2026-09-01T00:00:00Z",
    expiresAt: "2027-09-01T00:00:00Z",
    issuer: "xSOM benchmark",
    detectors,
    tests: {
      positives,
      negatives: Array.from({ length: 200 }, (_, index) =>
        `${String(index)} ${negative}`.slice(0, 2_000),
      ),
    },
  };
}

/** A text containing one hit of a pattern detector and one confidential term. */
export function largestPackCanary() {
  return "Le client CLI0-00421337 travaille sur nomcode1x42.";
}
