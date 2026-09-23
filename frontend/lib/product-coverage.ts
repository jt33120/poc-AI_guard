import source from "@/lib/generated/product-coverage.json";

export type DeveloperGuardMode = "B" | "D" | "O" | "A" | "X";
export type DeveloperGuardStatus = "implemented_local" | "out_of_scope";

export type DeveloperGuardCoverage = {
  readonly id: string;
  readonly product: "Developer Guard";
  readonly module: string;
  readonly status: DeveloperGuardStatus;
  readonly mode: DeveloperGuardMode;
  readonly hosts: readonly {
    readonly assistant: string;
    readonly events: readonly string[];
    readonly environment: string;
    readonly verified?: boolean;
  }[];
  readonly environment: string;
  readonly preconditions: readonly string[];
  readonly limit: string;
  readonly scenarios: readonly string[];
  readonly sources: readonly string[];
};

type CoverageDocument = {
  readonly schemaVersion: 1;
  readonly product: "Developer Guard";
  readonly threats: readonly DeveloperGuardCoverage[];
};

export const DEVELOPER_GUARD_COVERAGE = source as CoverageDocument;
export const DEVELOPER_GUARD_BY_THREAT = new Map(
  DEVELOPER_GUARD_COVERAGE.threats.map((entry) => [entry.id, entry]),
);

export function developerGuardFor(id: string): DeveloperGuardCoverage {
  const entry = DEVELOPER_GUARD_BY_THREAT.get(id);
  if (entry === undefined) throw new Error(`Missing generated Developer Guard coverage for ${id}`);
  return entry;
}
