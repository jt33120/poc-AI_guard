import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { redact, scan } from "@xsom/secret-guard-core";
import {
  acceptRulesPack,
  parseAuthorityKeys,
  type AcceptanceContext,
} from "../../packages/runner/src/index.js";

/**
 * The other half of `tests/test_rules_pack_cross_product.py`: the platform
 * composed and signed this envelope from an operator draft; the workstation must
 * accept it and apply exactly what the operator described. The clear terms of
 * the draft live only here and in the Python test, never in the signed file.
 */
const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

const fixture = read("../fixtures/platform-signed-rules-pack.json") as {
  payloadDigest: string;
  envelope: { payload: Record<string, unknown> };
};
const vector = (
  read("../../contracts/fixtures/rules-pack-vectors.json") as {
    signature: { publicKeyBase64: string };
  }
).signature;

const context: AcceptanceContext = {
  keys: parseAuthorityKeys(vector.publicKeyBase64),
  enrolledTenant: "00000000-0000-4000-8000-00000000c0de",
  highest: {},
  now: new Date("2026-10-01T00:00:00Z"),
};

function accepted() {
  const result = acceptRulesPack(fixture.envelope, context);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
}

const detectorIds = (content: string): string[] =>
  scan({ content, sourceKind: "prompt", rules: accepted().pack }).findings.map(
    (finding) => finding.custom?.detectorId ?? finding.secretType,
  );

describe("a rules pack signed by the platform", () => {
  it("is accepted under the xSOM authority key, with the platform's digest", () => {
    const result = accepted();
    expect(result.digest).toBe(fixture.payloadDigest);
    expect(result.expired).toBe(false);
  });

  it("detects what the operator described, and nothing in the negatives", () => {
    expect(detectorIds("Voir DOS-104233-FR et le contrat 4400012345.")).toEqual(
      ["heron.dossier", "heron.contrat"],
    );
    expect(detectorIds("curl https://API-01.Corp.Heron/health")).toEqual([
      "heron.hosts",
    ]);
    expect(detectorIds("Le ticket 4400012345 est clos.")).toEqual([]);
  });

  it("finds the confidential terms from their digests alone", () => {
    expect(
      detectorIds(
        "Point sur l'opération martin pêcheur, puis AIGRETTE ; le bec-jaune attendra.",
      ),
    ).toEqual(["heron.codenames", "heron.codenames", "heron.codenames"]);
    expect(detectorIds("Un martin, une aigrettes, un bec.")).toEqual([]);
  });

  it("masks each finding under its label and never exposes the value", () => {
    const content = "Dossier DOS-104233-FR pour l'opération Martin-Pêcheur.";
    const result = scan({
      content,
      sourceKind: "prompt",
      rules: accepted().pack,
    });
    expect(result.decision).toBe("BLOCK");
    const cleaned = redact(content, result.findings);
    expect(cleaned).not.toContain("104233");
    expect(cleaned).not.toContain("Martin");
    expect(JSON.stringify(result)).not.toContain("DOS-104233-FR");
  });

  it("is refused once a single field is altered", () => {
    const altered = {
      ...fixture.envelope,
      payload: { ...fixture.envelope.payload, version: 2 },
    };
    expect(acceptRulesPack(altered, context)).toMatchObject({
      ok: false,
      reason: "invalid_signature",
    });
  });
});
