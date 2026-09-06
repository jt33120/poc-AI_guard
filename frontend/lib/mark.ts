/**
 * Le tracé de la marque, en un seul endroit.
 *
 * Le bouclier apparaît à deux endroits qui ne peuvent pas se voir l'un l'autre :
 * `ShieldMark`, rendu par React dans la page, et `app/icon.svg`, servi comme favicon
 * — un fichier statique, qui ne peut donc rien importer. Deux dessins pour une même
 * marque finissent par diverger, et personne ne le remarque : l'onglet est le seul
 * endroit où l'on ne regarde jamais.
 *
 * Le fichier statique reste la copie ; `tests/test_brand_mark.py` interdit qu'elle
 * s'écarte de cette source.
 */

/** Le repère dans lequel les deux tracés sont exprimés. */
export const MARK_VIEWBOX = "0 0 24 24";

/** Le bouclier. */
export const MARK_SHIELD = "M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z";

/** La coche à l'intérieur. */
export const MARK_CHECK = "M9 12l2 2 4-4";
