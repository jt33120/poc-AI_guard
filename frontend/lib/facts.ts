/**
 * Les faits de couverture publiables sur la page (`L4`).
 *
 * Générés par `scripts/gen_marketing.py` depuis `coverage/map.json` et `core.triage`,
 * committés, et gatés en CI. Rien ici n'est écrit à la main, et le gate refuse qu'un
 * chiffre de couverture soit écrit ailleurs : dans le dictionnaire comme dans le
 * balisage, il doit passer par un `{placeholder}` que ces faits alimentent.
 *
 * La raison tient en une phrase : un chiffre écrit a raison le jour où on l'écrit, et
 * ment le jour où la carte change. C'est le défaut que `L0` a dû retirer de la page en
 * ligne, dont un « < 1 s » que `perf/overhead.json` refuse explicitement de publier.
 *
 * Ce sont des **bornes**, pas des promesses par client : sur un profil donné les
 * comptes sont plus bas, et viennent alors de `/api/threats`.
 */

import donnees from "@/lib/generated/marketing-facts.json";

export interface Faits {
  /** Les lignes de menace de la matrice. */
  lignes: number;
  /** Les facettes qui les composent — une ligne n'est pas une facette (§1.3). */
  facettes: number;
  /** Les lignes portant de quoi être montrées : blocage **et** contrôle négatif. */
  rejouables: number;
  /** Les profils d'usage proposés au visiteur. */
  profils: number;
  /** Lignes bloquées, tous profils tenus. Une borne, jamais un compte par client. */
  bloquees_max: number;
  /** Lignes sur notre terrain, tous profils tenus. */
  notre_terrain_max: number;
  /** Les écarts nommés que la carte publie avec leurs lignes. */
  ecarts: number;
}

export interface FaitsPublies {
  /** Le commit de la carte dont ces faits sont tirés. */
  commit: string;
  genere_le: string;
  faits: Faits;
}

// Sans cast, comme `lib/threats.ts` : `tsc` confronte ainsi le JSON généré aux types
// déclarés, et la CI rougit si le générateur change de forme sans que le front suive.
export const FAITS_PUBLIES: FaitsPublies = donnees;

/** Les faits seuls, prêts à passer en variables d'interpolation à `t()`. */
export const FAITS: Faits = FAITS_PUBLIES.faits;
