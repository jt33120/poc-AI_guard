/**
 * Le paysage des menaces, classé (`L4`).
 *
 * Ce fichier **ne revendique aucune couverture**, et c'est ce qui le distingue du
 * relevé. `lib/threats.ts` publie ce que la passerelle bloque, prouvé par des
 * scénarios et gaté en CI. Ici on répond à la question d'avant : *de quoi parle-t-on,
 * et qu'est-ce qui compte le plus ?* Aucune ligne n'affirme qu'un contrôle existe.
 *
 * La distinction n'est pas cosmétique. Une page commerciale qui mêlerait « voici la
 * menace » et « voici notre garantie » ferait lire la seconde dans la première, et
 * vingt-trois menaces se liraient comme vingt-trois protections. Les sept lignes sans
 * `releve` le disent d'ailleurs explicitement : elles ne sont pas encore évaluées par
 * la carte de couverture.
 *
 * **Le classement.** Probabilité multipliée par ce qu'on ne peut plus défaire. Ce
 * n'est pas le classement d'OWASP, qui ordonne par prévalence observée : ici le
 * lecteur déploie des agents qui *agissent*, et une menace qui n'aboutit qu'à une
 * réponse fausse ne pèse pas comme une qui vide un compte. Le rang est donc éditorial,
 * et il est assumé comme tel plutôt que présenté comme une mesure.
 *
 * **Le lien avec le relevé.** Les seize lignes qui portent un `releve` doivent exister
 * dans `lib/generated/threat-rows.json` et y porter le même titre français.
 * `tests/test_menaces_section.py` le vérifie dans les deux sens : aucune menace du
 * relevé ne peut disparaître d'ici en silence, et aucun titre ne peut diverger.
 */

import type { StrKey } from "@/lib/strings";

/**
 * Les cinq endroits par où une attaque entre, dans l'ordre du trajet.
 *
 * L'ordre est la légende : la pastille d'une rangée allume le point correspondant,
 * donc `invite` doit rester premier et `humain` dernier. Les réordonner déplacerait
 * silencieusement toutes les pastilles de la section.
 */
export const ETAPES = [
  "invite",
  "donnees",
  "modele",
  "actions",
  "humain",
] as const;

export type Etape = (typeof ETAPES)[number];

export interface Menace {
  /** Rang dans le classement, de 1 à N, sans trou ni doublon. */
  rang: number;
  /** L'identifiant de la ligne du relevé, ou `null` si la menace n'y est pas encore. */
  releve: string | null;
  etape: Etape;
  /** Le haut du classement, marqué comme tel : le lecteur qui ne lit que cinq lignes lit celles-là. */
  critique: boolean;
}

/**
 * Les vingt-trois menaces, du plus coûteux au moins coûteux.
 *
 * Les seize premières familles viennent de la matrice cyber IA du cabinet ; les sept
 * sans `releve` ont été ajoutées parce qu'elles manquaient et qu'elles visent
 * précisément ce produit : une passerelle d'outils est elle-même une surface
 * d'attaque (`06`), et un agent qui emprunte une identité humaine casse l'audit
 * (`07`) que le reste du produit existe pour tenir.
 */
export const MENACES: readonly Menace[] = [
  { rang: 1, releve: "M-02", etape: "donnees", critique: true },
  { rang: 2, releve: "M-12", etape: "actions", critique: true },
  { rang: 3, releve: "M-06", etape: "actions", critique: true },
  { rang: 4, releve: "M-10", etape: "donnees", critique: true },
  { rang: 5, releve: "M-13", etape: "actions", critique: true },
  { rang: 6, releve: null, etape: "donnees", critique: false },
  { rang: 7, releve: null, etape: "humain", critique: false },
  { rang: 8, releve: "M-01", etape: "invite", critique: false },
  { rang: 9, releve: "M-14", etape: "invite", critique: false },
  { rang: 10, releve: "M-15", etape: "humain", critique: false },
  { rang: 11, releve: "M-16", etape: "modele", critique: false },
  { rang: 12, releve: "M-11", etape: "modele", critique: false },
  { rang: 13, releve: null, etape: "donnees", critique: false },
  { rang: 14, releve: null, etape: "actions", critique: false },
  { rang: 15, releve: "M-03", etape: "donnees", critique: false },
  { rang: 16, releve: null, etape: "donnees", critique: false },
  { rang: 17, releve: null, etape: "actions", critique: false },
  { rang: 18, releve: "M-07", etape: "humain", critique: false },
  { rang: 19, releve: "M-08", etape: "humain", critique: false },
  { rang: 20, releve: null, etape: "modele", critique: false },
  { rang: 21, releve: "M-04", etape: "modele", critique: false },
  { rang: 22, releve: "M-09", etape: "modele", critique: false },
  { rang: 23, releve: "M-05", etape: "invite", critique: false },
] as const;

/** La clé du titre, dérivée du rang : les deux ne peuvent pas se désynchroniser. */
export function cleTitre(m: Menace): StrKey {
  return `land.menace.${String(m.rang).padStart(2, "0")}.t` as StrKey;
}

/** La clé de l'explication en clair. */
export function cleClair(m: Menace): StrKey {
  return `land.menace.${String(m.rang).padStart(2, "0")}.b` as StrKey;
}

/** Le libellé de l'étape d'entrée. */
export function cleEtape(etape: Etape): StrKey {
  return `land.menace.et.${etape}` as StrKey;
}
