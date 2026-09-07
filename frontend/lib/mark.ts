/**
 * Le tracé du bouclier coché, en un seul endroit.
 *
 * C'est une **icône d'interface** — une puce, le signe « contrôlé » dans les schémas —
 * et non la marque : le logo xSOM est servi depuis `public/xsom-mark.svg`, et l'onglet
 * montre le même logo (`app/icon.svg`, variante cuivre, comme `xsom.fr`).
 *
 * Ce module existe pour que `ShieldMark` n'ait pas à réécrire ses tracés là où il est
 * rendu. `tests/test_brand_mark.py` tient les deux bouts : le composant importe cette
 * source au lieu d'en recopier les valeurs, et le favicon ne les redessine pas — un
 * bouclier dans l'onglet donnerait au produit une marque que le site n'a jamais eue.
 */

/** Le repère dans lequel les deux tracés sont exprimés. */
export const MARK_VIEWBOX = "0 0 24 24";

/** Le bouclier. */
export const MARK_SHIELD = "M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z";

/** La coche à l'intérieur. */
export const MARK_CHECK = "M9 12l2 2 4-4";
