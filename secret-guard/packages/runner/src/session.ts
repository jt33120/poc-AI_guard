export interface SessionBudget {
  readonly maximumActions: number;
  readonly maximumDurationMs: number;
}
export interface SessionState {
  readonly startedAt: number;
  readonly actions: number;
}
export function sessionAllows(
  state: SessionState,
  budget: SessionBudget,
  now = Date.now(),
): boolean {
  return (
    state.actions < budget.maximumActions &&
    now - state.startedAt <= budget.maximumDurationMs
  );
}
