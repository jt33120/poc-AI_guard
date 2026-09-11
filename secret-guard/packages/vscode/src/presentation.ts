import type { Finding, ScanResult } from "@xsom/secret-guard-core";

const MAX_FINDINGS = 8;

export function findingSummary(finding: Finding): string {
  return `${finding.secretType} — ${finding.level} (${finding.score}/100), ligne ${finding.span.start.line}, colonne ${finding.span.start.column}`;
}

export function markdownReport(result: ScanResult): string {
  if (result.decision === "ALLOW") {
    return `$(unlock) Aucun secret détecté par les règles ${result.rulesetVersion}.`;
  }

  const title =
    result.decision === "BLOCK"
      ? "$(lock) **Contenu classé BLOCK par Secret Guard.**"
      : "$(warning) **Vérification requise par Secret Guard.**";
  const lines = result.findings.slice(0, MAX_FINDINGS).map((finding) => {
    const reasons =
      finding.reasons.length > 0 ? ` — ${finding.reasons.join(", ")}` : "";
    return `- ${findingSummary(finding)}${reasons}`;
  });
  const omitted = result.findings.length - lines.length;
  if (omitted > 0)
    lines.push(`- ${omitted} autre(s) détection(s) non affichée(s).`);
  if (!result.complete)
    lines.push("- L’entrée n’a pas pu être scannée intégralement.");
  lines.push(
    "La valeur détectée n’est ni affichée ni incluse dans ce rapport. L’interception par l’hôte n’est pas attestée.",
  );
  return [title, ...lines].join("\n");
}

export function modalReport(result: ScanResult): string {
  if (result.decision === "ALLOW") {
    return `Aucun secret détecté par les règles ${result.rulesetVersion}.`;
  }
  const first = result.findings[0];
  if (first === undefined) return "Analyse incomplète : contenu bloqué.";
  const extra =
    result.findings.length > 1 ? ` (+${result.findings.length - 1})` : "";
  return `${findingSummary(first)}${extra}. Aucune valeur sensible n’est affichée.`;
}
