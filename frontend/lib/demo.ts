/**
 * L'instantané du tenant de démonstration (`L8`).
 *
 * Cette page affichait des chiffres **écrits à la main** : `governed: 8`, `allow: 124`,
 * `review: 37`, `block: 9`. Le tenant réel en compte **5** gouvernés et **93**
 * autorisations. Les chiffres inventés flattaient — c'est ce que fait toujours un
 * chiffre inventé, sans qu'on l'ait décidé, et c'est pourquoi `L0` les a retirés du
 * héros et `L4` les interdit dans la copie.
 *
 * Ce qui les remplace est une **lecture réelle** : `tests/test_demo_snapshot.py` sème
 * `demo/seed.yaml` dans une base neuve pendant la suite, vérifie la chaîne d'audit,
 * puis relit. La fixture est committée, relisible et entièrement fabriquée, et un garde
 * de CI vérifie avec les détecteurs du produit qu'elle ne porte aucune forme de PII
 * réelle (`AD-31`).
 *
 * Les jours sont **relatifs** : `payload_v1` date chaque entrée à l'exécution, donc des
 * dates absolues changeraient à chaque capture et aucun gate d'égalité ne les tiendrait.
 */

import donnees from "@/lib/generated/demo-snapshot.json";

/** Une entrée du journal, telle qu'elle peut être publiée. */
export interface EntreeInstantane {
  /** Ancienneté en jours. Relative, donc stable d'une capture à l'autre. */
  jours: number;
  outil: string | null;
  classe: string | null;
  decision: string | null;
  regle: string | null;
  raison: string | null;
}

export interface Instantane {
  /** Le commit de la carte dont cet instantané est contemporain. */
  commit: string;
  genere_le: string;
  tenant: string;
  /** Les outils que la policy de démonstration gouverne. */
  outils: number;
  entrees: number;
  /** Chaîne confrontée par `core.audit.verify_chain` au moment de la capture. */
  chainee: boolean;
  jours_couverts: number;
  decisions: Record<string, number>;
  classes: Record<string, number>;
  journal: EntreeInstantane[];
}

// Sans cast, comme les autres artefacts générés : `tsc` confronte le JSON aux types.
export const INSTANTANE: Instantane = donnees;

/**
 * Les trois seaux que la synthèse dirigeant affiche.
 *
 * Le vocabulaire des décisions est ouvert ; ce qui est fermé, c'est ce que chaque
 * famille **veut dire** pour un dirigeant : l'action a eu lieu, un humain a été
 * sollicité, ou elle n'a pas eu lieu. Une décision inconnue tombe dans « soumise à un
 * humain » plutôt que dans « autorisée » — se tromper du côté prudent est le seul
 * choix défendable sur une page publique.
 */
export function seaux(decisions: Record<string, number>): {
  allow: number;
  review: number;
  block: number;
} {
  const out = { allow: 0, review: 0, block: 0 };
  for (const [decision, n] of Object.entries(decisions)) {
    if (decision === "allow") out.allow += n;
    else if (decision === "deny" || decision === "hitl_denied") out.block += n;
    else out.review += n;
  }
  return out;
}
