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

  /**
   * `parent` shares a larger budget across several meters, e.g. one hook
   * event that scans a prompt and the files it mentions.
   */
  public constructor(
    public readonly limit: number,
    private readonly parent?: WorkMeter,
  ) {}

  public spend(units: number): void {
    this.used += units;
    this.parent?.spend(units);
    if (this.used > this.limit) throw new WorkBudgetExceeded();
  }

  /** Units still available here and in every parent. */
  public remaining(): number {
    const own = this.limit - this.used;
    return this.parent === undefined
      ? own
      : Math.min(own, this.parent.remaining());
  }
}

/** Raised when the custom rules find more matches than a scan may report. */
export class TooManyMatches extends Error {
  public constructor() {
    super("custom_findings_limit_exceeded");
  }
}

/** Measured ratio between one SHA-256 compression and one matcher step. */
export const HASH_BLOCK_COST = 80;
