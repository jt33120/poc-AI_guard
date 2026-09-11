import {
  redact,
  RULESET_VERSION,
  scan,
  type ScanInput,
  type ScanResult,
} from "@xsom/secret-guard-core";

export type WarnChoice = "send" | "redact" | "cancel";

export interface DispatchOutcome {
  readonly initial: ScanResult;
  readonly final: ScanResult;
  readonly sent: boolean;
  readonly redacted: boolean;
}

export interface DispatchDependencies {
  readonly chooseForWarning: (result: ScanResult) => Promise<WarnChoice>;
  readonly transport: (content: string) => Promise<void>;
  readonly scanner?: (input: ScanInput) => ScanResult;
}

function scannerFailure(content: string): ScanResult {
  const position = { offset: 0, line: 1, column: 1 } as const;
  return {
    decision: "BLOCK",
    level: "CRITICAL",
    score: 100,
    findings: [
      {
        ruleId: "scanner_failure",
        secretType: "scan_error",
        span: { start: position, end: position },
        score: 100,
        level: "CRITICAL",
        reasons: ["scanner_failed_closed"],
        encoding: "plain",
      },
    ],
    complete: false,
    inputBytes: new TextEncoder().encode(content).byteLength,
    rulesetVersion: RULESET_VERSION,
  };
}

export async function dispatchGuarded(
  content: string,
  dependencies: DispatchDependencies,
): Promise<DispatchOutcome> {
  const scanner = dependencies.scanner ?? scan;
  let initial: ScanResult;
  try {
    initial = scanner({ content, sourceKind: "prompt" });
  } catch {
    initial = scannerFailure(content);
  }

  if (!initial.complete || initial.decision === "BLOCK") {
    return { initial, final: initial, sent: false, redacted: false };
  }

  if (initial.decision === "ALLOW") {
    await dependencies.transport(content);
    return { initial, final: initial, sent: true, redacted: false };
  }

  const choice = await dependencies.chooseForWarning(initial);
  if (choice === "cancel") {
    return { initial, final: initial, sent: false, redacted: false };
  }
  if (choice === "send") {
    await dependencies.transport(content);
    return { initial, final: initial, sent: true, redacted: false };
  }

  const sanitized = redact(content, initial.findings);
  let final: ScanResult;
  try {
    final = scanner({ content: sanitized, sourceKind: "prompt" });
  } catch {
    final = scannerFailure(sanitized);
  }
  if (!final.complete || final.decision !== "ALLOW") {
    return { initial, final, sent: false, redacted: true };
  }
  await dependencies.transport(sanitized);
  return { initial, final, sent: true, redacted: true };
}
