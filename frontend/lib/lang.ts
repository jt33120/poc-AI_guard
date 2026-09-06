/**
 * La langue, résolue **côté serveur**.
 *
 * Elle vivait dans `localStorage`, lu par un `useEffect`. Trois conséquences, toutes
 * visibles : le rendu partait en anglais puis basculait après hydratation, le serveur
 * ne pouvait pas connaître la langue et `<html lang>`, écrit en dur à `fr`, qualifiait
 * un texte rendu en anglais, et toute
 * page affichant un mot devenait un composant client — donc incapable d'exporter
 * `metadata`.
 *
 * Un cookie corrige les trois d'un coup : le serveur le lit avant de rendre, il n'y a
 * donc rien à rattraper après coup.
 *
 * **Le français est la valeur par défaut**, et ce n'est pas un réglage : le cabinet
 * est français, le marché visé l'est, et le site mère l'est. L'anglais est la langue
 * alternative, pas la langue de repli.
 */

import type { Metadata } from "next";
import { cookies } from "next/headers";

import { STR, type Lang, type StrKey } from "@/lib/strings";

export const LANG_COOKIE = "xsom_lang";
export const DEFAULT_LANG: Lang = "fr";

/** La langue de cette requête. Fail-soft : une valeur inconnue retombe sur le défaut. */
export function getLang(): Lang {
  const brut = cookies().get(LANG_COOKIE)?.value;
  return brut === "en" || brut === "fr" ? brut : DEFAULT_LANG;
}

/**
 * Traduire, sans React.
 *
 * Même contrat que le `t` du hook client, volontairement : deux fonctions de
 * traduction qui divergeraient produiraient deux textes pour la même clé, et
 * personne ne le verrait avant de comparer les deux rendus.
 */
export function translate(
  lang: Lang,
  key: StrKey,
  vars?: Record<string, string | number>,
): string {
  let s: string = STR[key]?.[lang] ?? STR[key]?.en ?? String(key);
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Le traducteur de cette requête, prêt à passer à un composant serveur. */
export function serverT(): { t: (k: StrKey, vars?: Record<string, string | number>) => string; lang: Lang } {
  const lang = getLang();
  return { t: (k, vars) => translate(lang, k, vars), lang };
}

/**
 * La `metadata` d'une page, dans la langue de la requête.
 *
 * Le gabarit de titre est posé par le layout racine (`%s · xSOM AI Guard`) : une
 * page ne fournit donc que son propre titre. `noindex` sert aux écrans qui n'ont
 * rien à faire dans un index public — les formulaires d'authentification et la
 * console derrière session : indexés, ils feraient entrer des pages vides, et
 * pour la console, une arborescence privée, dans les résultats de recherche.
 */
export function pageMetadata(
  titleKey: StrKey,
  opts: { descriptionKey?: StrKey; noindex?: boolean } = {},
): Metadata {
  const lang = getLang();
  const meta: Metadata = { title: translate(lang, titleKey) };
  if (opts.descriptionKey) meta.description = translate(lang, opts.descriptionKey);
  if (opts.noindex) meta.robots = { index: false, follow: false };
  return meta;
}
