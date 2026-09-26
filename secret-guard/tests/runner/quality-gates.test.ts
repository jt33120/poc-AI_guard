import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  qualityGateAllows,
  validateQualityReceipt,
} from "../../packages/runner/src/index.js";

describe("quality receipts", () => {
  it("binds a receipt to its exact commit and accepts no unstructured scanner output", () => {
    const receipt = {
      analyzer: "semgrep",
      analyzerVersion: "1.0",
      commitSha: "abc1234",
      verdict: "pass",
      sarif: {
        version: "2.1.0",
        runs: [
          {
            tool: { driver: { name: "semgrep", version: "1.0" } },
            results: [],
          },
        ],
      },
    };
    expect(qualityGateAllows(validateQualityReceipt(receipt, "abc1234"))).toBe(
      true,
    );
    expect(validateQualityReceipt(receipt, "other")).toBeUndefined();
    expect(
      validateQualityReceipt({ ...receipt, verdict: "unknown" }, "abc1234"),
    ).toBeUndefined();
  });

  it("accepts the pass/fail fixtures and rejects malformed or dishonest SARIF", () => {
    const fixture = (name: string): unknown =>
      JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL(`../../contracts/fixtures/${name}.json`, import.meta.url),
          ),
          "utf8",
        ),
      );
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(
      qualityGateAllows(validateQualityReceipt(fixture("quality-pass"), sha)),
    ).toBe(true);
    expect(
      qualityGateAllows(validateQualityReceipt(fixture("quality-fail"), sha)),
    ).toBe(false);
    expect(
      validateQualityReceipt(fixture("quality-malformed"), sha),
    ).toBeUndefined();
    const dishonest = fixture("quality-fail") as Record<string, unknown>;
    expect(
      validateQualityReceipt({ ...dishonest, verdict: "pass" }, sha),
    ).toBeUndefined();
  });
});
