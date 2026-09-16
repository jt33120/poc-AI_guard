import type { Finding, ScanResult, SecretType } from "@xsom/secret-guard-core";

const MAX_FINDINGS = 8;

const TYPES: Record<SecretType, string> = {
  private_key: "Clé privée",
  provider_token: "Jeton de service",
  access_token: "Jeton d’accès",
  jwt: "Jeton JWT",
  database_credentials: "Identifiants de base de données",
  cloud_credential: "Identifiants cloud",
  password: "Mot de passe",
  api_key: "Clé API",
  generic_secret: "Secret potentiel",
  high_entropy: "Valeur à vérifier",
  scan_limit: "Limite d’analyse",
  scan_error: "Analyse indisponible",
};

export function findingSummary(finding: Finding): string {
  return `${TYPES[finding.secretType]} · ligne ${finding.span.start.line}, colonne ${finding.span.start.column}`;
}

export function markdownReport(result: ScanResult): string {
  if (result.decision === "ALLOW") {
    return `🛡️ **Secret Guard · Analyse terminée**\n\nAucun secret détecté par les règles ${result.rulesetVersion}.\n\n_Analyse locale · Aucun contenu envoyé par le détecteur._`;
  }

  const title =
    result.decision === "BLOCK"
      ? "🛡️ **Secret Guard · Contenu sensible détecté**"
      : "🔎 **Secret Guard · Vérification nécessaire**";
  const lines = result.findings
    .slice(0, MAX_FINDINGS)
    .map((finding) => `- ${findingSummary(finding)}`);
  const omitted = result.findings.length - lines.length;
  if (omitted > 0)
    lines.push(`- ${omitted} autre(s) détection(s) non affichée(s).`);
  if (!result.complete)
    lines.push("- L’entrée n’a pas pu être scannée intégralement.");
  return [
    title,
    "",
    lines.join("\n"),
    "",
    "**Avant de partager** · Retirez les valeurs sensibles ou utilisez la version expurgée lorsqu’elle est proposée.",
    "",
    "_🔒 Valeurs masquées dans ce rapport · Analyse locale. Ce résultat ne confirme pas l’interception par un autre assistant._",
  ].join("\n");
}

export function modalReport(result: ScanResult): string {
  if (result.decision === "ALLOW") {
    return `🛡️ Secret Guard · Aucun secret détecté par les règles ${result.rulesetVersion}. Analyse locale terminée.`;
  }
  const first = result.findings[0];
  if (first === undefined)
    return "⚠️ Secret Guard · Analyse incomplète. Vérifiez le contenu avant de le partager.";
  const extra =
    result.findings.length > 1 ? ` (+${result.findings.length - 1})` : "";
  return `🛡️ Secret Guard · ${findingSummary(first)}${extra}. Retirez la valeur sensible avant de partager. Elle n’est pas affichée dans ce rapport.`;
}
