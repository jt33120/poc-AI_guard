import type { Finding, ScanResult } from "@xsom/secret-guard-core";

const MAX_REPORTED_FINDINGS = 8;

export function describeFinding(finding: Finding): string {
  const { line, column } = finding.span.start;
  return `${finding.secretType} (${finding.level}, ${finding.score}/100) at line ${line}, column ${column}`;
}

export function humanReport(result: ScanResult): string {
  if (result.decision === "ALLOW") {
    return `No secret detected by rules ${result.rulesetVersion}.`;
  }

  const heading =
    result.decision === "BLOCK"
      ? "Secret Guard classified this content as blocked."
      : "Secret Guard found content that requires review.";
  const findings = result.findings
    .slice(0, MAX_REPORTED_FINDINGS)
    .map((finding) => `- ${describeFinding(finding)}`);
  const omitted = result.findings.length - findings.length;
  if (omitted > 0) findings.push(`- ${omitted} additional finding(s) omitted.`);
  if (!result.complete)
    findings.push("- The scan could not cover the complete input.");
  return [heading, ...findings].join("\n");
}

export function hookMessage(result: ScanResult): string {
  const first = result.findings[0];
  if (first === undefined) {
    return result.complete
      ? "Secret Guard could not establish a safe verdict."
      : "Secret Guard blocked because the input could not be scanned completely.";
  }
  const { line, column } = first.span.start;
  const extra =
    result.findings.length > 1 ? ` and ${result.findings.length - 1} more` : "";
  return `Secret Guard detected ${first.secretType} at line ${line}, column ${column}${extra}. The detected value is not included in this hook result; host interception is not attested.`;
}
