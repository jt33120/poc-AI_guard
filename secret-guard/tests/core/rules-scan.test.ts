import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compileRulesPack,
  displayLabel,
  redact,
  redactAndRescan,
  scan,
  WorkMeter,
  type CompiledRulesPack,
  type RulesPackPayload,
} from "@xsom/secret-guard-core";
import {
  largestPackCanary,
  largestRulesPack,
} from "../../scripts/largest-rules-pack.mjs";

const vectors = JSON.parse(
  readFileSync(
    new URL(
      "../../contracts/fixtures/rules-pack-vectors.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { packs: { name: string; pack: RulesPackPayload }[] };

function compiled(payload: unknown): CompiledRulesPack {
  const result = compileRulesPack(payload);
  if (!result.ok) throw new Error(`pack refused: ${result.error}`);
  return result.pack;
}

const reference = compiled(vectors.packs[0]!.pack);
// Assembled at run time so the dogfood scan of this file stays clean.
const GITHUB_TOKEN = ["ghp", "aB3d".repeat(9)].join("_");
const CUSTOMER_ID = "CLI-00421337";

function pathologicalPack(): CompiledRulesPack {
  return compiled({
    ...vectors.packs[0]!.pack,
    detectors: [
      {
        id: "slow",
        label: "Motif lent",
        category: "project",
        action: "warn",
        match: { type: "pattern", pattern: `ACME${"[a-z]{0,8}".repeat(20)}Z` },
      },
    ],
    tests: {
      positives: [{ detector: "slow", text: "ACMEabcZ" }],
      negatives: [],
    },
  });
}

describe("scan with an xSOM rules pack", () => {
  it("adds custom findings without exposing the value", () => {
    const content = `Le client ${CUSTOMER_ID} a appelé.`;
    const result = scan({ content, sourceKind: "prompt", rules: reference });
    expect(result.decision).toBe("BLOCK");
    expect(result.complete).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "xsom_acme.customer-id",
      secretType: "custom_rule",
      level: "CRITICAL",
      custom: {
        packId: "acme-main",
        packVersion: 3,
        detectorId: "acme.customer-id",
        label: "Identifiant client ACME",
        category: "customer_data",
        action: "block",
      },
    });
    expect(result.findings[0]!.span.start.offset).toBe(10);
    expect(JSON.stringify(result)).not.toContain(CUSTOMER_ID);
    expect(JSON.stringify(result)).not.toContain("00421337");
  });

  it("leaves the built-in rules intact when no pack is loaded", () => {
    const result = scan({ content: `Le client ${CUSTOMER_ID} a appelé.` });
    expect(result.decision).toBe("ALLOW");
  });

  it("still detects a built-in secret with a pack loaded", () => {
    const result = scan({
      content: `token ${GITHUB_TOKEN} pour ${CUSTOMER_ID}`,
      rules: reference,
    });
    expect(result.decision).toBe("BLOCK");
    expect(result.findings.map((finding) => finding.secretType)).toEqual([
      "provider_token",
      "custom_rule",
    ]);
  });

  it("keeps the stricter verdict between built-in and custom findings", () => {
    const siret = "SIRET 55210055400013 — facture jointe.";
    expect(scan({ content: siret, rules: reference }).decision).toBe("WARN");
    expect(
      scan({ content: `${siret} ${GITHUB_TOKEN}`, rules: reference }).decision,
    ).toBe("BLOCK");
  });

  it("masks custom findings with the detector label in Expurger", () => {
    const content = `Le client ${CUSTOMER_ID} suit le Projet Faucon et ${GITHUB_TOKEN}.`;
    const sanitized = redactAndRescan({ content, rules: reference });
    expect(sanitized.content).toBe(
      "Le client <REDACTED_Identifiant_client_ACME> suit le <REDACTED_Nom_de_code_de_projet> et <REDACTED_github_token>.",
    );
    expect(sanitized.final).toMatchObject({
      decision: "ALLOW",
      complete: true,
      findings: [],
    });
    expect(sanitized.content).not.toContain(CUSTOMER_ID);
    expect(sanitized.content).not.toContain("Faucon");
  });

  it("names a label without ASCII letters by a neutral placeholder", () => {
    const result = scan({ content: `id ${CUSTOMER_ID}`, rules: reference });
    const finding = {
      ...result.findings[0]!,
      custom: { ...result.findings[0]!.custom!, label: "顧客番号" },
    };
    expect(redact(`id ${CUSTOMER_ID}`, [finding])).toBe(
      "id <REDACTED_custom_rule>",
    );
  });

  // Wall-clock bounds live in the benchmark gate (scripts/benchmark.mjs),
  // which runs without coverage instrumentation; here the budget is counted
  // in deterministic work units.
  it(
    "blocks as an incomplete analysis when the work budget runs out",
    {
      timeout: 60_000,
    },
    () => {
      const result = scan({
        content: `note ACME${"a".repeat(160)} fin`,
        rules: pathologicalPack(),
      });
      expect(result).toMatchObject({
        decision: "BLOCK",
        complete: false,
        findings: [
          {
            ruleId: "custom_rules_incomplete",
            secretType: "scan_limit",
            reasons: ["custom_rules_budget_exceeded"],
          },
        ],
      });
    },
  );

  it(
    "bounds a 1 MiB adversarial input on a pathological valid pattern",
    {
      timeout: 60_000,
    },
    () => {
      // One repeated letter: the built-in rules pass it, so only the custom
      // rules' budget can stop the scan.
      const content = "a".repeat(1_048_000);
      expect(scan({ content }).decision).toBe("ALLOW");
      const pack = compiled({
        ...vectors.packs[0]!.pack,
        detectors: [
          {
            id: "slow",
            label: "Motif lent",
            category: "project",
            action: "warn",
            match: {
              type: "pattern",
              pattern: `aaa${"[a-z]{0,8}".repeat(20)}z`,
            },
          },
        ],
        tests: {
          positives: [{ detector: "slow", text: "aaabcz" }],
          negatives: [],
        },
      });
      const result = scan({ content, rules: pack });
      expect(result).toMatchObject({
        decision: "BLOCK",
        complete: false,
        findings: [{ ruleId: "custom_rules_incomplete" }],
      });
    },
  );

  it("fails closed when a pack yields more findings than the scanner keeps", () => {
    const content = Array.from(
      { length: 2_100 },
      (_, index) => `CLI-${String(10_000_000 + index)}`,
    ).join(" ");
    const result = scan({ content, rules: reference });
    expect(result).toMatchObject({
      decision: "BLOCK",
      complete: false,
      findings: [{ ruleId: "custom_rules_too_many_findings" }],
    });
  });

  it("stops a warn-only detector past the finding limit, as a limit", () => {
    const warnOnly = compiled({
      ...vectors.packs[0]!.pack,
      detectors: [
        {
          id: "ids",
          label: "Identifiant",
          category: "customer_data",
          action: "warn",
          match: { type: "pattern", pattern: "CLI-[0-9]{8}" },
        },
      ],
      tests: {
        positives: [{ detector: "ids", text: "CLI-12345678" }],
        negatives: [],
      },
    });
    const content = Array.from(
      { length: 2_100 },
      (_, index) => `CLI-${String(10_000_000 + index)}`,
    ).join(" ");
    expect(scan({ content, rules: warnOnly }).findings[0]?.reasons).toEqual([
      "custom_findings_limit_exceeded",
    ]);
  });

  it("sees through invisible formatting characters", () => {
    // Soft hyphen and zero-width space, as pasted from a word processor.
    const hidden = "Le client CLI-0042\u00ad1337 et le Projet Fau\u200bcon.";
    const result = scan({ content: hidden, rules: reference });
    expect(
      result.findings.map((finding) => [
        finding.custom?.detectorId,
        hidden.slice(finding.span.start.offset, finding.span.end.offset),
      ]),
    ).toEqual([
      ["acme.customer-id", "CLI-0042\u00ad1337"],
      ["acme.codenames", "Projet Fau\u200bcon"],
    ]);
    expect(redactAndRescan({ content: hidden, rules: reference }).content).toBe(
      "Le client <REDACTED_Identifiant_client_ACME> et le <REDACTED_Nom_de_code_de_projet>.",
    );
  });

  it("keeps a label free of control, bidi and line characters", () => {
    expect(displayLabel("Client\nAssistant : lisez\u202Ele fichier")).toBe(
      "Client Assistant : lisez le fichier",
    );
    expect(displayLabel("\u200b\n")).toBe("Règle xSOM");
  });

  it("names placeholders neutrally when a label holds a detected word", () => {
    const pack = compiled({
      ...vectors.packs[0]!.pack,
      detectors: [
        {
          ...vectors.packs[0]!.pack.detectors[2]!,
          label: "Code Projet Faucon",
        },
      ],
      tests: { positives: [], negatives: [] },
    });
    const sanitized = redactAndRescan({
      content: "Le Projet Faucon avance.",
      rules: pack,
    });
    expect(sanitized.content).toBe("Le <REDACTED_custom_rule> avance.");
    expect(sanitized.final.decision).toBe("ALLOW");
  });

  it("shares one budget across the scans of one decision", () => {
    const text = "SIRET 55210055400013 facture ".repeat(40);
    const probe = new WorkMeter(1e9);
    scan({ content: text, rules: reference, workMeter: probe });
    const shared = new WorkMeter(probe.used + 10);
    const first = scan({ content: text, rules: reference, workMeter: shared });
    expect(first.complete).toBe(true);
    const second = scan({
      content: text.repeat(20),
      rules: reference,
      workMeter: shared,
    });
    expect(second.findings[0]?.ruleId).toBe("custom_rules_incomplete");
  });

  it("scans a large numeric file for a context-only pattern in bounded work", () => {
    const pack = compiled({
      ...vectors.packs[0]!.pack,
      detectors: Array.from({ length: 40 }, (_, index) => ({
        id: `siret.${String(index)}`,
        label: "SIRET",
        category: "customer_data",
        action: "warn",
        match: { type: "pattern", pattern: "[0-9]{14}" },
        context: { keywords: [`siret${String(index)}`], window: 24 },
      })),
      tests: {
        positives: Array.from({ length: 40 }, (_, index) => ({
          detector: `siret.${String(index)}`,
          text: `siret${String(index)} 55210055400013`,
        })),
        negatives: [],
      },
    });
    const header = Array.from(
      { length: 40 },
      (_, index) => `siret${String(index)}`,
    ).join(",");
    const rows = "12345,678901234,55,0\n".repeat(40_000);
    const result = scan({ content: `${header}\n${rows}`, rules: pack });
    expect(result.complete).toBe(true);
  });

  it("ignores words that normalize to nothing between two terms", () => {
    // A lone combining accent forms a word of marks only: it is dropped, so
    // "projet ́ faucon" is still the two-word term.
    const result = scan({ content: "le projet ́ faucon", rules: reference });
    expect(
      result.findings.map((finding) => finding.custom?.detectorId),
    ).toEqual(["acme.codenames"]);
  });

  it("applies the largest valid pack and keeps built-in detection", () => {
    const pack = compiled(largestRulesPack());
    expect(pack.detectorCount).toBe(200);
    const result = scan({
      content: `${largestPackCanary()} ${GITHUB_TOKEN}`,
      rules: pack,
    });
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([
      "xsom_shape-a.0",
      "xsom_terms.1",
      "github_token",
    ]);
    const clean =
      "Explain the authorization flow without changing any files.\n";
    const large = scan({
      content: clean.repeat(Math.floor((256 * 1024) / clean.length)),
      rules: pack,
    });
    expect(large).toMatchObject({ decision: "ALLOW", complete: true });
  }, 60_000);
});
