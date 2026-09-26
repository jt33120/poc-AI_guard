import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compileRulesPack,
  normalizeTerm,
  termDigest,
  validatePattern,
  WorkMeter,
  type DetectorSpec,
} from "@xsom/secret-guard-core";
import {
  CompiledRulesPack,
  compileDetector,
} from "../../packages/core/src/custom/pack.js";
import type { RulesPackPayload } from "../../packages/core/src/custom/schema.js";
import { decodeBase64 } from "../../packages/core/src/custom/terms.js";

// The frozen contract shared with the AI Guard platform. Every vector must
// pass exactly; the file itself is never edited here.
const vectors = JSON.parse(
  readFileSync(
    new URL(
      "../../contracts/fixtures/rules-pack-vectors.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  grammar: {
    pattern: string;
    hasContext: boolean;
    valid: boolean;
    error?: string;
  }[];
  detection: {
    name: string;
    detector: DetectorSpec;
    text: string;
    matches: string[];
  }[];
  terms: {
    salt: string;
    cases: { term: string; normalized: string; digest: string }[];
  };
  packs: { name: string; pack: unknown; valid: boolean; error?: string }[];
};

function detectorPack(detector: DetectorSpec, text: string): RulesPackPayload {
  // A minimal valid pack around one vector detector, without self-tests that
  // would already assume the expected result.
  return {
    schemaVersion: 1,
    kind: "xsom.secret-guard.rules-pack",
    packId: "vector",
    tenantId: "tenant",
    version: 1,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z",
    issuer: "xSOM",
    detectors: [detector],
    tests: {
      positives:
        detector.match.type === "pattern"
          ? [{ detector: detector.id, text }]
          : [],
      negatives: [],
    },
  };
}

describe("rules pack contract vectors", () => {
  it("has the frozen number of vectors", () => {
    expect(vectors.grammar).toHaveLength(59);
    expect(vectors.detection).toHaveLength(20);
    expect(vectors.packs).toHaveLength(10);
  });

  it.each(vectors.grammar.map((vector, index) => [index, vector] as const))(
    "grammar vector %i",
    (_index, vector) => {
      const result = validatePattern(vector.pattern, vector.hasContext);
      if (vector.valid) expect(result).toMatchObject({ ok: true });
      else expect(result).toEqual({ ok: false, error: vector.error });
    },
  );

  it.each(vectors.detection.map((vector) => [vector.name, vector] as const))(
    "detection: %s",
    (_name, vector) => {
      // The detector alone, without the pack self-tests (a vector with no
      // match could not carry the positive a pattern detector requires).
      const detector = compileDetector(vector.detector);
      expect(detector).toBeDefined();
      const pack = new CompiledRulesPack(
        detectorPack(vector.detector, vector.text),
        [detector!],
      );
      const [matches] = pack.detect(vector.text, new WorkMeter(1e9));
      expect(
        (matches ?? []).map((match) =>
          vector.text.slice(match.start, match.end),
        ),
      ).toEqual(vector.matches);
    },
  );

  it.each(vectors.terms.cases.map((entry) => [entry.term, entry] as const))(
    "terms digest of %j",
    (_term, entry) => {
      const normalized = normalizeTerm(entry.term);
      expect(normalized).toBe(entry.normalized);
      expect(termDigest(decodeBase64(vectors.terms.salt), normalized)).toBe(
        entry.digest,
      );
    },
  );

  it.each(vectors.packs.map((vector) => [vector.name, vector] as const))(
    "pack validity: %s",
    (_name, vector) => {
      const result = compileRulesPack(vector.pack);
      if (vector.valid) expect(result).toMatchObject({ ok: true });
      else expect(result).toEqual({ ok: false, error: vector.error });
    },
  );
});
