/**
 * Les rejeux : la même action jouée deux fois, garde retiré puis garde en place (`L6`).
 *
 * Généré par `scripts/gen_replays.py` **depuis une exécution réelle de la suite de
 * tests**, committé, et gaté en CI. `AD-26` pose la règle : une vidéo est
 * l'enregistrement d'une exécution qui passe, jamais un substitut. Rien ici n'est
 * animé, reconstitué, ni écrit à la main.
 *
 * Le gate exige qu'une séquence existe pour **chaque** ligne rejouable : une rangée
 * qui annonce « voir le blocage » et s'ouvrirait sur du vide est refusée en CI.
 */

import donnees from "@/lib/generated/replays.json";

/** Une entrée du journal d'audit, telle que le produit l'écrit. */
export interface EntreeAudit {
  tool_name: string | null;
  action_class: string | null;
  decision: string | null;
  policy_rule_id: string | null;
  judge_used: boolean | null;
  /** Une empreinte, jamais les arguments (`CLAUDE.md` §4.10). */
  args_hash: string | null;
  error: string | null;
}

export interface Execution {
  /** Le test dont cette séquence est l'enregistrement. Nommé pour être rejouable. */
  test: string;
  /** Chaîne confrontée par `core.audit.verify_chain` au moment de la capture. */
  chainee: boolean;
  entrees: EntreeAudit[];
}

export interface Rejeu {
  facette: string;
  ingress: string | null;
  /** Les outils appelés, identiques dans les deux colonnes : c'est la règle d'appariement. */
  outils: string[];
  /**
   * Le rang de la première entrée où les deux colonnes cessent de coïncider.
   *
   * Dérivé côté Python plutôt que déduit ici d'un vocabulaire de décisions : celui-ci
   * est ouvert (`allow`, `deny`, `hitl_pending`, `taint_marked`, `tainted_action`…) et
   * une table écrite côté page vieillirait en silence.
   */
  divergence: number | null;
  sans_garde: Execution;
  avec_garde: Execution;
}

export interface Rejeux {
  /** Le commit de la carte dont ces rejeux sont contemporains. */
  commit: string;
  genere_le: string;
  rejeux: Record<string, Rejeu>;
  /**
   * Les lignes rejouables qui n'ont **pas** de rejeu, avec la raison publiée.
   *
   * Déclarée côté générateur, jamais devinée ici. `M-14` en est le cas de fond : sa
   * preuve est qu'un argument secret n'atteint pas le journal, si bien que les deux
   * exécutions décident légitimement `allow` et qu'il n'y a rien à mettre côte à côte.
   * Publier deux colonnes identiques y montrerait un écran où rien ne se passe.
   */
  sans_rejeu: Record<string, string>;
}

// Sans cast, comme les autres artefacts générés : `tsc` confronte le JSON aux types.
export const REJEUX: Rejeux = donnees;

/** Le rejeu d'une ligne, ou `undefined` si elle n'en a pas. */
export function rejeuDe(rowId: string): Rejeu | undefined {
  return REJEUX.rejeux[rowId];
}

/** Pourquoi une ligne rejouable n'a pas de rejeu, quand c'est le cas. */
export function raisonSansRejeu(rowId: string): string | undefined {
  return REJEUX.sans_rejeu[rowId];
}
