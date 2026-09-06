/**
 * Le relevé des menaces, côté front (`L3`).
 *
 * Deux moitiés, et la frontière entre elles est la règle du chantier.
 *
 * **Ce qui ne dépend d'aucun visiteur** — les 16 lignes, leurs facettes, leur mode
 * publié, les profils qu'elles concernent — vient de `generated/threat-rows.json`,
 * produit par `scripts/gen_threat_rows.py` depuis `coverage/map.json` et gaté en CI.
 * Rien n'est écrit à la main ici, et rien ne peut l'être : le fichier est régénéré.
 *
 * **Ce qui dépend du visiteur** — ce qui le concerne, ce que son plafond de profil
 * rabat, à qui revient le reste, et surtout les *comptes* — se demande à
 * `/api/threats`. Le recalculer ici donnerait un second moteur, et le premier
 * désaccord entre les deux se lirait sur une page commerciale. L'écart n'est pas
 * théorique : sur le profil `P1a`, la carte compte 3 facettes bloquées et 2 lignes
 * bloquées. Le nombre à écrire à côté du mot « ligne » est 2.
 */

import donnees from "@/lib/generated/threat-rows.json";

/** Les modes de couverture publiables. `NA` dit qu'aucune revendication n'est faite. */
export type Mode = "B" | "D" | "O" | "A" | "X" | "NA";

/** À qui le problème appartient. */
export type Famille = "fournisseur" | "cyber_classique" | "usage_ia";

export type ProfilId = "P1a" | "P1b" | "P2" | "P3" | "P4" | "P5";

export interface Facette {
  cle: string;
  libelle: string;
  mode: string;
  famille: string;
  profils: string[];
  ingress_prouve: string[];
  ingress_non_asserte: string[];
  scenarios: string[];
  ecarts: string[];
  raison: string | null;
}

export interface LigneMenace {
  id: string;
  titre: string;
  /** La ligne porte-t-elle de quoi être **montrée** plutôt qu'affirmée. */
  rejouable: boolean;
  profils: string[];
  facettes: Facette[];
}

export interface Releve {
  /** Le commit de la carte dont ce relevé est tiré. */
  commit: string;
  genere_le: string;
  lignes: LigneMenace[];
}

// Assigné **sans cast**, et c'est délibéré : `as Releve` n'aurait rien vérifié.
// Ainsi, `tsc` confronte structurellement le JSON généré aux types ci-dessus, et la
// CI rougit si `scripts/gen_threat_rows.py` change de forme sans que ce fichier suive.
export const RELEVE: Releve = donnees;

/** Ce que renvoie `/api/threats` : les chiffres, calculés par le moteur. */
export interface ReleveProfil {
  profiles: string[];
  cap: string | null;
  counts: { lines: number; applicable: number; ours: number; blocked: number };
  /** L'énoncé de `THREAT-COVERAGE` §2.5, ou `null` tant qu'aucun profil n'est coché. */
  statement: string | null;
  rows: {
    id: string;
    titre: string;
    applicable: boolean;
    blocked: boolean;
    owner: string;
    facets: { libelle: string; mode: string }[];
    activates_at: string[];
  }[];
}

/**
 * Demander le relevé positionné.
 *
 * Ne rattrape pas l'erreur : l'appelant décide quoi montrer, et une valeur de repli
 * inventée ici deviendrait une couverture affirmée sans preuve.
 */
export async function fetchReleveProfil(profils: readonly string[]): Promise<ReleveProfil> {
  const res = await fetch(`/api/threats?profiles=${encodeURIComponent(profils.join(","))}`);
  if (!res.ok) {
    const corps = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(corps.detail ?? "Relevé indisponible");
  }
  return (await res.json()) as ReleveProfil;
}
