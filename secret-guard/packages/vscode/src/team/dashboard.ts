import { escapeHtml, type DashboardTeam } from "../dashboard.js";
import type { GatewayState } from "./gateway-integration.js";
import type { RulesPackView } from "./rules-pack-view.js";

export interface DashboardGateway {
  readonly state: GatewayState;
  readonly status: string;
  readonly audit?: string;
}

export const TEAM_DASHBOARD_COMMANDS = [
  "secretGuard.connectGateway",
  "secretGuard.disconnectGateway",
  "secretGuard.requestRulesPack",
] as const;

function rulesSection(rules: RulesPackView | undefined): string {
  return rules === undefined
    ? ""
    : `<section aria-labelledby="rules"><div class="section-heading"><h2 id="rules">Règles sur mesure</h2><span>Édition Équipe · signées par xSOM</span></div><div class="policy rules ${rules.tone}"><strong>${escapeHtml(rules.title)}</strong><p>${escapeHtml(rules.detail)}</p>${rules.offerRequest ? '<a href="command:secretGuard.requestRulesPack">Demander un réglage à xSOM →</a>' : ""}</div><p class="note">Aucune case à cocher : le réglage est calibré avec xSOM, vérifié hors ligne et appliqué localement, sans LLM ni réseau pendant l’analyse.</p></section>`;
}

function gatewaySection(gateway: DashboardGateway): string {
  const action =
    gateway.state === "offline"
      ? '<a class="button" href="command:secretGuard.connectGateway">Raccorder ce poste →</a>'
      : '<a class="button" href="command:secretGuard.disconnectGateway">Déconnecter le relais</a>';
  return `<section aria-labelledby="gateway"><div class="section-heading"><h2 id="gateway">Relais de protection · Claude</h2></div><div class="policy"><strong>${escapeHtml(gateway.status)}</strong>${gateway.audit === undefined ? "" : `<p>${escapeHtml(gateway.audit)}</p>`}<p>Nettoyage obligatoire avant transmission, dans les sessions Claude raccordées. L’abonnement et la connexion restent gérés par Claude. Les autres assistants gardent leurs protections locales.</p><p>Après connexion, seules des métadonnées d’audit sont enregistrées : poste, date, résultat et nombre de détections. Aucun prompt ni secret dans ce journal. Le contenu original transite par votre passerelle pour être nettoyé.</p><p>La passerelle reste en mode Expurger, même si le mode local change. Pièces jointes non analysables : envoi refusé.</p>${action}</div></section>`;
}

/** The xSOM tuning and the Claude relay, as sections of the protection centre. */
export function teamDashboard(
  gateway: DashboardGateway = { state: "offline", status: "Non connecté" },
  rules?: RulesPackView,
): DashboardTeam {
  return {
    sections: `${rulesSection(rules)}\n${gatewaySection(gateway)}`,
    attachmentsCovered: gateway.state === "online",
  };
}
