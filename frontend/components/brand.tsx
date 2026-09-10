/**
 * Les signes de marque : le logo xSOM, le mot-marque, et les pastilles d'état.
 *
 * Deux marques cohabitent ici, et ce n'est pas un doublon :
 *
 * - `XsomMark` est **le logo de l'entreprise** : les trois flèches coudées
 *   entrelacées, servi depuis `public/xsom-mark.svg`, copie exacte de
 *   `assets/logo/moderne-dark.svg` du site. Il n'apparaît que dans un bloc de
 *   marque : en-tête, pied de page, écrans d'authentification, chargeur.
 * - `ShieldMark` est une **icône d'interface** : un bouclier coché, qui veut dire
 *   « contrôlé ». Il sert de puce et de pictogramme dans les schémas, il n'a
 *   jamais été le logo — et le favicon ne le montre plus : `app/icon.svg` porte
 *   désormais la variante bleue originale du vrai logo. `tests/test_brand_mark.py` tient
 *   la même propriété qu'avant (« la marque a un tracé, pas deux ») mais sur les
 *   deux cibles qui sont réellement la marque : le favicon et `xsom-mark.svg`.
 *   Il interdit maintenant explicitement `MARK_SHIELD` dans le favicon.
 *
 * Le logo est servi en `<img>` et non inline : il porte trois masques avec leurs
 * `id`, et deux copies inline dans la même page (en-tête et pied) produiraient des
 * `id` en double. Un fichier séparé, c'est en plus une seule requête mise en cache
 * pour tout le site : le même arbitrage que `xsom.fr`.
 */

import { MARK_CHECK, MARK_SHIELD, MARK_VIEWBOX } from "@/lib/mark";

/**
 * Original xSOM variants, selected by the shared theme without altering the SVG.
 *
 * `alt=""` : le logo est décoratif. Le nom accessible « xSOM AI Guard » est porté
 * par le texte posé à côté ; donner un `alt` au signe le ferait annoncer deux fois
 * par un lecteur d'écran, et `e2e/smoke.spec.ts` cherche ce nom-là sur le `h1`,
 * pas sur l'image.
 *
 * `width`/`height` en attributs même si la classe redimensionne : ils donnent le
 * ratio intrinsèque, donc pas de saut de mise en page au chargement.
 */
export function XsomMark({ className = "h-[42px] w-[42px]" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`xsom-brand-mark shrink-0 ${className}`}>
      {/* SVG assets already carry their original paths; no raster optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/xsom-mark.svg"
        alt=""
        width={42}
        height={42}
        className="xsom-brand-mark__dark"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/xsom-mark-light.svg"
        alt=""
        width={42}
        height={42}
        className="xsom-brand-mark__light"
      />
    </span>
  );
}

export function ShieldMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={MARK_SHIELD} />
      <path d={MARK_CHECK} />
    </svg>
  );
}

export function Wordmark({
  className = "",
  tagline,
}: {
  className?: string;
  tagline?: string;
}) {
  // Le contenu textuel reste « xSOM AI Guard » : le nom accessible ne bouge pas.
  // La baseline est un frère du nom, jamais un enfant, sinon elle entrerait dans
  // le nom accessible que le test e2e cherche.
  return (
    <span>
      <span className={`brand__name ${className}`}>
        xSOM <span className="brand__product">AI Guard</span>
      </span>
      {tagline ? <span className="brand__tag">{tagline}</span> : null}
    </span>
  );
}

function badgeClass(value: string | null | undefined): string {
  const v = (value ?? "").toLowerCase();
  if (v.includes("deny") || v.includes("denied") || v.includes("error")) return "badge-red";
  if (v.includes("allow") || v.includes("approved") || v.includes("auto")) return "badge-green";
  if (v.includes("pending") || v.includes("hitl") || v.includes("expired")) return "badge-amber";
  if (v.includes("flag") || v.includes("redact")) return "badge-amber";
  return "badge-neutral";
}

export function DecisionBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-white/30">—</span>;
  return <span className={`badge ${badgeClass(value)}`}>{value}</span>;
}
