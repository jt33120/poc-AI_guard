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
      : "Secret Guard n’a pas pu analyser le texte en entier.";
  }
  const { line, column } = first.span.start;
  const extra =
    result.findings.length > 1 ? ` and ${result.findings.length - 1} more` : "";
  return `🛡️ Secret Guard · Contenu à vérifier\n\nSecret Guard detected ${first.secretType} at line ${line}, column ${column}${extra}.\n\nPour nettoyer le texte : copiez votre message, cliquez sur Secret Guard dans la barre de VS Code, puis sur « Vérifier le presse-papiers ». Si une version nettoyée est disponible, choisissez « Copier la version expurgée », puis collez-la dans votre chat.\nLes valeurs détectées ne sont pas affichées dans ce rapport.`;
}
