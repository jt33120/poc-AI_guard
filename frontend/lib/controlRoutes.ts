/**
 * Ce que la console a le droit de demander à travers le proxy.
 *
 * `app/api/control/[...path]/route.ts` relaie une requête du navigateur vers l'API en
 * y attachant le jeton porteur de la session — c'est ce qui permet de ne jamais poser
 * ce jeton dans le navigateur (`CLAUDE.md` §4.5). Sans liste blanche, il relayait
 * **n'importe quelle méthode vers n'importe quel chemin**, et le rôle du compte
 * devenait l'unique contrôle de sécurité : une session `viewer` atteignait toute route
 * de l'API, y compris celles ajoutées plus tard et que personne n'avait pensé à
 * protéger côté rôle.
 *
 * Cette table est donc la définition de la surface : ce que la console fait, et rien
 * d'autre. Elle n'est pas déduite de ce que l'API expose — l'API en expose davantage,
 * et c'est précisément l'écart qu'on ferme.
 *
 * Elle a été **relevée sur les appels réels** de `lib/client.ts`, pas devinée :
 * `v1/clients/assign` en fait partie et aucune supposition raisonnable ne l'aurait
 * produit. `tests/test_control_proxy.py` confronte la table aux appels du code à chaque
 * exécution, donc un appel ajouté sans sa règle échoue en CI plutôt qu'en production.
 */

interface Route {
  /** Le chemin, ancré, tel qu'il arrive après `/api/control/`. */
  readonly pattern: RegExp;
  readonly methods: readonly string[];
}

/**
 * Un segment d'identifiant : ni vide, ni un point, ni un séparateur, ni un caractère
 * encodé. C'est ce qui interdit `..`, `%2e%2e` et tout ce qui ferait sortir du chemin.
 */
const SEG = "[A-Za-z0-9_-]{1,64}";
const POLICY_SEG = "[a-z0-9][a-z0-9._-]{0,127}";

export const CONTROL_ROUTES: readonly Route[] = [
  { pattern: new RegExp("^v1/extensions/devices$"), methods: ["GET"] },
  { pattern: new RegExp("^v1/extensions/events$"), methods: ["GET"] },
  { pattern: new RegExp("^v1/extensions/verify$"), methods: ["GET"] },
  { pattern: new RegExp("^v1/developer-policies$"), methods: ["GET"] },
  {
    pattern: new RegExp(`^v1/developer-policies/${POLICY_SEG}$`),
    methods: ["PUT"],
  },
  {
    pattern: new RegExp(
      `^v1/developer-policies/${POLICY_SEG}/assign/${SEG}$`,
    ),
    methods: ["POST"],
  },
  // Règles sur mesure : lecture du client, atelier des opérateurs xSOM. L'API décide
  // qui est opérateur (`XSOM_OPERATOR_SUBJECTS`) ; cette table ne fait que borner les
  // chemins que la console emprunte.
  { pattern: new RegExp("^v1/rules-pack$"), methods: ["GET"] },
  { pattern: new RegExp("^v1/xsom/tenants$"), methods: ["GET"] },
  {
    pattern: new RegExp(`^v1/xsom/tenants/${SEG}/rules-pack$`),
    methods: ["GET"],
  },
  {
    pattern: new RegExp(`^v1/xsom/tenants/${SEG}/rules-pack/(?:dry-run|publish)$`),
    methods: ["POST"],
  },
  { pattern: new RegExp("^v1/agents$"), methods: ["GET"] },
  { pattern: new RegExp("^v1/approvals$"), methods: ["GET"] },
  { pattern: new RegExp(`^v1/approvals/${SEG}/decision$`), methods: ["POST"] },
  { pattern: new RegExp("^v1/audit$"), methods: ["GET"] },
  { pattern: new RegExp("^v1/audit/export$"), methods: ["GET"] },
  { pattern: new RegExp("^v1/clients$"), methods: ["GET", "POST"] },
  { pattern: new RegExp("^v1/clients/assign$"), methods: ["POST"] },
  { pattern: new RegExp(`^v1/clients/${SEG}$`), methods: ["DELETE"] },
  { pattern: new RegExp("^v1/credentials$"), methods: ["GET", "POST"] },
  { pattern: new RegExp(`^v1/credentials/${SEG}$`), methods: ["DELETE"] },
  { pattern: new RegExp("^v1/dlp$"), methods: ["GET", "PUT"] },
  { pattern: new RegExp("^v1/gateway-tokens$"), methods: ["GET", "POST"] },
  { pattern: new RegExp(`^v1/gateway-tokens/${SEG}$`), methods: ["DELETE"] },
  { pattern: new RegExp("^v1/policy$"), methods: ["GET", "PUT"] },
  { pattern: new RegExp("^v1/policy/draft$"), methods: ["POST"] },
  { pattern: new RegExp("^v1/read-tokens$"), methods: ["GET", "POST"] },
  { pattern: new RegExp(`^v1/read-tokens/${SEG}$`), methods: ["DELETE"] },
  { pattern: new RegExp("^v1/servers$"), methods: ["GET"] },
  { pattern: new RegExp("^v1/tools$"), methods: ["GET"] },
  { pattern: new RegExp("^v1/tools/integrity$"), methods: ["GET"] },
  { pattern: new RegExp("^v1/trust$"), methods: ["GET"] },
  { pattern: new RegExp("^v1/usage$"), methods: ["GET"] },
];

/**
 * Un segment sûr : ni vide, ni point initial, ni séparateur, ni encodage.
 * Les expressions de route restent plus étroites : seul un identifiant de politique
 * peut contenir un point interne.
 *
 * Next décode les segments avant de les remettre ici, donc `%2e%2e` arrive sous la
 * forme `..`. Le test porte donc sur la valeur décodée, la seule qui compte.
 */
function segmentSain(segment: string): boolean {
  return /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/.test(segment);
}

/**
 * La requête est-elle une de celles que la console émet ?
 *
 * Fail-closed (`CLAUDE.md` §4.4) : tout ce qui n'est pas explicitement listé est
 * refusé, y compris une route que l'API expose parfaitement.
 */
export function routeAllowed(
  method: string,
  segments: readonly string[],
): boolean {
  if (segments.length === 0 || !segments.every(segmentSain)) {
    return false;
  }
  const chemin = segments.join("/");
  const verbe = method.toUpperCase();
  return CONTROL_ROUTES.some(
    (route) => route.pattern.test(chemin) && route.methods.includes(verbe),
  );
}
