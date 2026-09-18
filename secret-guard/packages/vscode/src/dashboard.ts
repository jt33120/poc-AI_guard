import type { HookHealth } from "./hook-manager.js";
import type { ProtectionMode } from "@xsom/secret-guard-cli/hook";
import { PROTECTION_MODES, modeLabel } from "./protection-mode.js";

export const DASHBOARD_COMMANDS = [
  "secretGuard.showDashboard",
  "secretGuard.chooseMode",
  "secretGuard.enableHook",
  "secretGuard.finishCodexSetup",
  "secretGuard.scanClipboard",
  "secretGuard.purgeClipboard",
  "secretGuard.scanDocument",
  "secretGuard.connectGateway",
  "secretGuard.disconnectGateway",
] as const;

export const HEALTH_LABELS = {
  active: "Prêt à veiller",
  partial: "Configuration à compléter",
  degraded: "Protection à vérifier",
  off: "Protection désactivée",
} as const;

export const HEALTH_REASONS: Record<HookHealth["reason"], string> = {
  local_canaries_verified:
    "Configuration et tests locaux vérifiés. Validez le blocage dans chaque assistant utilisé.",
  not_configured:
    "Activez Secret Guard pour configurer les assistants compatibles.",
  config_invalid: "Une configuration d’assistant doit être vérifiée.",
  hook_missing: "Le composant local de protection est absent.",
  hook_modified: "Le composant local diffère de la version installée.",
  canary_failed: "Le test local de protection n’a pas abouti.",
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] ?? character,
  );
}

export function dashboardHtml(
  health: HookHealth,
  mode: ProtectionMode,
  nonce: string,
  modeApplicationFailed = false,
  gatewaySummary = "Non connecté",
): string {
  const hosts = health.hosts
    .map((host) => {
      const healthy =
        host.configured &&
        (health.state === "active" || health.state === "partial");
      const label = healthy
        ? "Configuré"
        : host.configured
          ? "À vérifier"
          : "Non configuré";
      const detail =
        host.id === "codex"
          ? "Approbation du hook requise dans Codex."
          : "Blocage à confirmer dans votre session.";
      return `<article class="host"><div class="host-top"><span class="host-icon" aria-hidden="true">${host.id === "claude" ? "✳" : host.id === "codex" ? "⌘" : "◇"}</span><span class="badge ${healthy ? "ready" : "attention"}">${label}</span></div><h3>${escapeHtml(host.label)}</h3><p>${detail}</p>${host.id === "codex" && host.configured ? '<a href="command:secretGuard.finishCodexSetup">Finaliser Codex <span aria-hidden="true">↗</span></a>' : ""}</article>`;
    })
    .join("");
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${escapeHtml(nonce)}'; base-uri 'none'; form-action 'none'">
<title>Secret Guard · Centre de protection</title>
<style nonce="${escapeHtml(nonce)}">
:root{color-scheme:light dark;--ink:var(--vscode-foreground,#dae2ed);--muted:var(--vscode-descriptionForeground,#a0aec0);--surface:var(--vscode-editor-background,#101820);--card:var(--vscode-sideBar-background,#17232e);--line:var(--vscode-widget-border,#394a59);--accent:var(--vscode-textLink-foreground,#60d8c0);--good:var(--vscode-testing-iconPassed,#67c9a4);--warn:var(--vscode-editorWarning-foreground,#e8b562)}
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--ink);font-family:var(--vscode-font-family,system-ui);font-size:14px;line-height:1.6}main{max-width:960px;margin:0 auto;padding:36px 32px 44px}header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:24px;border-bottom:1px solid var(--line)}.brand{display:flex;gap:12px;align-items:center}.brand svg{width:36px;height:40px;color:var(--accent)}.brand strong{display:block;font-size:17px;letter-spacing:-.4px}.eyebrow{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted)}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}a:focus-visible{outline:2px solid var(--vscode-focusBorder,#58c5c5);outline-offset:5px;border-radius:3px}.refresh{font-size:12px;white-space:nowrap}.intro{padding:34px 0 24px}.intro h1{font-size:clamp(26px,5vw,40px);line-height:1.12;letter-spacing:-1.2px;font-weight:650;margin:12px 0}.intro p{max-width:580px;color:var(--muted);margin:14px 0}.status{display:flex;align-items:flex-start;gap:16px;background:var(--card);border:1px solid var(--line);border-left:3px solid var(--good);border-radius:12px;padding:22px}.status.partial,.status.degraded,.status.off{border-left-color:var(--warn)}.status-icon{font-size:22px}.status h2{font-size:18px;margin:0 0 4px}.status p{color:var(--muted);margin:0;font-size:13px}.status-copy{flex:1}.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 15px;border-radius:7px;background:var(--vscode-button-background,#126c69);color:var(--vscode-button-foreground,#fff);font-weight:600;font-size:12px}.button:hover{background:var(--vscode-button-hoverBackground,#175f5d);text-decoration:none}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:32px 0 14px}.section-heading h2{margin:0;font-size:16px}.section-heading span{font-size:11px;color:var(--muted)}.hosts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.host{padding:18px;background:var(--card);border:1px solid var(--line);border-radius:10px}.host-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.host-icon{font-size:26px;color:var(--accent)}.badge{font-size:10px;border:1px solid currentColor;border-radius:20px;padding:2px 8px}.ready{color:var(--good)}.attention{color:var(--warn)}h3{font-size:14px;margin:14px 0 6px}.host p{font-size:12px;line-height:1.5;color:var(--muted);margin:0 0 10px}.host a{font-size:12px}.actions{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.action{display:flex;gap:14px;padding:18px;border:1px solid var(--line);border-radius:10px;color:var(--ink)}.action:hover{background:var(--card);text-decoration:none}.action-icon{font-size:22px}.action strong{display:block;font-size:13px}.action small{display:block;color:var(--muted);margin-top:3px;font-size:12px}.policy{margin-top:20px;padding:14px 16px;border-radius:8px;border:1px dashed var(--line);font-size:12px;color:var(--muted)}.policy strong{color:var(--ink)}footer{margin-top:32px;padding-top:18px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:14px;color:var(--muted);font-size:11px}.note{font-size:11px;color:var(--muted);margin-top:14px}body.vscode-high-contrast .host,body.vscode-high-contrast-light .host{border-color:var(--vscode-contrastBorder)}@media(max-width:560px){main{padding:22px 18px}.status{flex-wrap:wrap}.status .button{margin-left:38px}.actions{grid-template-columns:1fr}footer{flex-direction:column}.section-heading{align-items:flex-start}.section-heading span{max-width:130px;text-align:right}}
</style></head><body><main>
<header><div class="brand"><svg viewBox="0 0 32 36" fill="none" aria-hidden="true"><path d="M16 2 29 7v11c0 8-13 16-13 16S3 26 3 18V7L16 2Z" stroke="currentColor" stroke-width="2"/><path d="m10 17 4 4 8-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg><div><strong>Secret Guard</strong><span class="eyebrow">by xSOM · Local first</span></div></div><a class="refresh" href="command:secretGuard.showDashboard">↻ Actualiser</a></header>
<section class="intro"><span class="eyebrow">Votre espace de protection</span><h1>Vos idées à l’IA.<br>Vos secrets restent à l’abri.</h1><p>Détectez les informations sensibles dans vos prompts grâce à une analyse locale, intégrée à votre environnement de travail.</p></section>
<section class="status ${modeApplicationFailed ? "degraded" : health.state}" aria-label="État de la protection"><span class="status-icon" aria-hidden="true">${health.state === "active" && !modeApplicationFailed ? "🛡️" : "⚠️"}</span><div class="status-copy"><h2>${modeApplicationFailed ? "Mode à appliquer" : HEALTH_LABELS[health.state]}</h2><p>${modeApplicationFailed ? "Le mode sélectionné n’a pas pu être appliqué aux assistants. Réessayez la configuration." : HEALTH_REASONS[health.reason]}</p></div>${health.state !== "active" || modeApplicationFailed ? '<a class="button" href="command:secretGuard.enableHook">Configurer la protection →</a>' : ""}</section>
<section aria-labelledby="assistants"><div class="section-heading"><h2 id="assistants">Vos assistants</h2><span>État de la configuration locale</span></div><div class="hosts">${hosts || '<p class="note">État des assistants indisponible. Actualisez pour réessayer.</p>'}</div><p class="note">Les sessions distantes et les politiques d’entreprise peuvent modifier la prise en charge. Un test dans chaque assistant confirme l’interception.</p></section>
<section aria-labelledby="actions"><div class="section-heading"><h2 id="actions">Un doute avant de partager ?</h2><span>Analyse à votre demande</span></div><div class="actions"><a class="action" href="command:secretGuard.scanClipboard"><span class="action-icon" aria-hidden="true">📋</span><span><strong>Vérifier le presse-papiers</strong><small>Scannez le texte que vous allez coller.</small></span></a><a class="action" href="command:secretGuard.purgeClipboard"><span class="action-icon" aria-hidden="true">🧹</span><span><strong>Expurger le presse-papiers</strong><small>Remplacez-le par sa version expurgée, prête à coller.</small></span></a><a class="action" href="command:secretGuard.scanDocument"><span class="action-icon" aria-hidden="true">🔎</span><span><strong>Vérifier le document</strong><small>Analysez le fichier ouvert dans l’éditeur.</small></span></a></div></section>
<section aria-labelledby="mode"><div class="section-heading"><h2 id="mode">Votre mode de protection</h2><a class="button" href="command:secretGuard.chooseMode">Changer de mode ▾</a></div><div class="policy"><strong>${modeLabel(mode)}</strong><p>${PROTECTION_MODES.find((entry) => entry.mode === mode)?.description}</p><p>${PROTECTION_MODES.find((entry) => entry.mode === mode)?.detail}</p></div><p class="note">Réglage commun aux assistants de cette installation. Après un changement, ouvrez une nouvelle session de votre assistant ; Codex peut demander de valider le hook actualisé.</p></section>
<section aria-labelledby="gateway"><div class="section-heading"><h2 id="gateway">🌐 Passerelle xSOM · Claude</h2></div><div class="policy"><strong>${escapeHtml(gatewaySummary)}</strong><p>Nettoyage obligatoire avant transmission, dans les sessions Claude raccordées. L’abonnement et la connexion restent gérés par Claude. Les autres assistants gardent leurs protections locales.</p><p>Après connexion, seules des métadonnées d’audit sont enregistrées : poste, date, résultat et nombre de détections. Aucun prompt ni secret dans ce journal. Le contenu original transite par votre passerelle pour être nettoyé.</p><p>La passerelle reste en mode Expurger, même si le mode local change. Pièces jointes non analysables : envoi refusé.</p><a class="button" href="command:secretGuard.connectGateway">Raccorder ce poste →</a> <a href="command:secretGuard.disconnectGateway">Déconnecter</a></div></section>
<footer><span>Analyse locale · Aucun appel réseau du détecteur</span><span>Audit distant uniquement après raccordement xSOM</span></footer>
</main></body></html>`;
}
