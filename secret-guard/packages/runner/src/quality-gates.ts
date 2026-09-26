export interface QualityReceipt {
  readonly analyzer: string;
  readonly analyzerVersion: string;
  readonly commitSha: string;
  readonly verdict: "pass" | "fail";
  readonly sarif: {
    readonly version: "2.1.0";
    readonly runs: readonly {
      readonly tool: {
        readonly driver: { readonly name: string; readonly version: string };
      };
      readonly results: readonly { readonly level?: string }[];
    }[];
  };
}

function validSarif(value: unknown): value is QualityReceipt["sarif"] {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const sarif = value as Record<string, unknown>;
  if (sarif.version !== "2.1.0" || !Array.isArray(sarif.runs)) return false;
  return sarif.runs.every((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    )
      return false;
    const run = candidate as Record<string, unknown>;
    const tool = run.tool as Record<string, unknown> | undefined;
    const driver = tool?.driver as Record<string, unknown> | undefined;
    return (
      typeof driver?.name === "string" &&
      typeof driver.version === "string" &&
      Array.isArray(run.results) &&
      run.results.every(
        (result) => typeof result === "object" && result !== null,
      )
    );
  });
}

export function validateQualityReceipt(
  value: unknown,
  expectedCommit: string,
): QualityReceipt | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const receipt = value as Record<string, unknown>;
  if (
    typeof receipt.analyzer !== "string" ||
    !receipt.analyzer ||
    typeof receipt.analyzerVersion !== "string" ||
    !receipt.analyzerVersion ||
    typeof receipt.commitSha !== "string" ||
    receipt.commitSha !== expectedCommit ||
    (receipt.verdict !== "pass" && receipt.verdict !== "fail") ||
    !validSarif(receipt.sarif)
  )
    return undefined;
  const normalized = receipt as unknown as QualityReceipt;
  const errors = normalized.sarif.runs.some((run) =>
    run.results.some((result) => result.level === "error"),
  );
  if (normalized.verdict === "pass" && errors) return undefined;
  return normalized;
}

export function qualityGateAllows(
  receipt: QualityReceipt | undefined,
): boolean {
  return receipt?.verdict === "pass";
}
