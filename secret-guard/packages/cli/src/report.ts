import type { Finding, ScanResult } from "@xsom/secret-guard-core";

const MAX_REPORTED_FINDINGS = 8;

/**
 * What was found, never the value: the secret type, or the signed label of
 * an xSOM custom detector.
 */
export function findingName(finding: Finding): string {
  return finding.custom === undefined
    ? finding.secretType
    : `« ${finding.custom.label} » (réglage xSOM)`;
}

export function describeFinding(finding: Finding): string {
  const { line, column } = finding.span.start;
  return `${findingName(finding)} (${finding.level}, ${finding.score}/100) at line ${line}, column ${column}`;
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

/** One line saying what was found and where, never the value. */
export function findingSummary(result: ScanResult): string {
  const first = result.findings[0];
  if (!result.complete)
    return first?.reasons.includes("custom_rules_budget_exceeded") === true
      ? "Secret Guard n’a pas pu terminer l’analyse du réglage xSOM (texte trop long ou trop complexe) : analyse incomplète, envoi bloqué."
      : "Secret Guard n’a pas pu analyser le texte en entier : analyse incomplète, envoi bloqué.";
  if (first === undefined) {
    return result.complete
      ? "Secret Guard could not establish a safe verdict."
      : "Secret Guard n’a pas pu analyser le texte en entier.";
  }
  const { line, column } = first.span.start;
  const extra =
    result.findings.length > 1 ? ` and ${result.findings.length - 1} more` : "";
  return `Secret Guard detected ${findingName(first)} at line ${line}, column ${column}${extra}.`;
}

export function hookMessage(result: ScanResult): string {
  const summary = findingSummary(result);
  if (result.findings.length === 0) return summary;
  return `🛡️ Secret Guard · Contenu à vérifier\n\n${summary}\n\nPour nettoyer le texte : copiez votre message, cliquez sur Secret Guard dans la barre d’état de VS Code, choisissez « Expurger » dans l’alerte, puis collez la version nettoyée dans votre chat.\nLes valeurs détectées ne sont pas affichées dans ce rapport.`;
}
