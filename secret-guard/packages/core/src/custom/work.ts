/** Raised when a scan spends more work than its budget allows. */
export class WorkBudgetExceeded extends Error {
  public constructor() {
    super("custom_rules_budget_exceeded");
  }
}

/**
 * Deterministic work accounting for the xSOM custom rules: one unit is one
 * matcher step (a character test or a backtracking move); one SHA-256
 * compression costs `HASH_BLOCK_COST` units. Exceeding the limit aborts the
 * scan, which the scanner reports as an incomplete analysis (BLOCK).
 */
export class WorkMeter {
  public used = 0;

  public constructor(public readonly limit: number) {}

  public spend(units: number): void {
    this.used += units;
    if (this.used > this.limit) throw new WorkBudgetExceeded();
  }
}

/** Measured ratio between one SHA-256 compression and one matcher step. */
export const HASH_BLOCK_COST = 80;
