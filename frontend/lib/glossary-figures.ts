/**
 * Quelle figure explique quelle fiche du glossaire.
 *
 * Les figures du dépôt sont indexées par **rang de menace** (`lib/schemas.ts`) et le
 * glossaire par **identifiant de fiche** : il en range bien plus que les vingt-trois
 * rangs du classement, et beaucoup n'ont aucune figure. Le rapprochement devait donc
 * être écrit quelque part, et justifié : deux rangs partagent parfois le même code
 * OWASP, et une fiche décrit parfois un mécanisme que le classement découpe autrement.
 *
 * Il se fait sur le **mécanisme que la fiche décrit**, jamais sur le code OWASP
 * qu'elle cite : c'est l'attaque type que le lecteur a sous les yeux, et une figure
 * qui dessinerait le voisin lui apprendrait le voisin. Une fiche sans figure vaut
 * mieux qu'une fiche mal illustrée.
 */

import { GLOSSARY_SCHEMAS } from "@/lib/glossary-schemas";
import { SCHEMAS } from "@/lib/schemas";

/** Le rang dont la figure explique la fiche, et la raison de ce rang-là. */
const RANG: Record<string, number | undefined> = {
  // L'exemple historique de la fiche est un document à résumer qui porte une
  // consigne cachée, donc l'injection indirecte. Le rang 8 dessine la directe.
  "injection-de-prompt": 1,
  "injection-directe": 8,
  // Le titre du rang est celui de la fiche, mot pour mot.
  "autonomie-excessive": 2,
  // Les outils de l'agent retournés contre vous : un virement, une suppression, un envoi.
  "transactions-non-autorisees": 3,
  // Une donnée interne collée dans un assistant public se disperse : c'est
  // exactement l'exemple de la fiche.
  "fuite-de-donnees": 4,
  // Le rang 5 dessine une sortie de modèle exécutée par la machine.
  "sorties-non-maitrisees": 5,
  // La fiche validée puis réécrite hors contrôle : le rug pull.
  "outil-piege": 6,
  "identite-empruntee": 7,
  // La consigne et la clé écrite dedans, livrées sur demande.
  "extraction-prompt-systeme": 9,
  // La fiche définit du code intégré « sans validation suffisante ». Le rang 5, qui
  // porte pourtant le code LLM05 qu'elle cite, dessine une sortie de modèle exécutée
  // par la machine : ce n'est pas la même faute.
  "code-vulnerable": 10,
  // La décision prise sur un fait inventé, sans qu'aucun contrôle ne se déclenche.
  hallucinations: 11,
  // Seul rang de la chaîne d'approvisionnement.
  "dependances-compromises": 12,
  "memoire-empoisonnee": 13,
  // Le rang 14 dessine une boucle agent-modèle sans frein : le mécanisme de la fiche.
  // Le déni de portefeuille en est la conséquence voulue, pas le même dessin.
  "boucle-agent": 14,
  // Seul rang de l'empoisonnement de données.
  empoisonnement: 15,
  // Le rang 16 parle de cloisonnement entre clients : c'est cette fiche-ci, et non
  // `acces-rag`, qui parle des droits de la personne qui interroge.
  "fuite-inter-clients-rag": 16,
  "delegation-en-cascade": 17,
  "phishing-augmente": 18,
  // Le rang 19 dessine la voix clonée du dirigeant : il explique les deux fiches.
  "usurpation-deepfake": 19,
  "fraude-voix-clonee": 19,
  "derive-de-modele": 20,
  "extraction-par-api": 21,
  "malware-genere": 22,
  "exemples-adverses": 23,
  // `acces-rag` n'est pas ici : aucun rang ne dessine son mécanisme. Le seul
  // voisin, le rang 16, parle de cloisonnement entre clients quand la fiche parle
  // des droits de la personne qui interroge. Sa figure est écrite à part.
};

/** Le corps SVG qui explique cette fiche, ou rien si aucune ne lui correspond. */
export function figureDeFiche(id: string): string | undefined {
  const rang = RANG[id];
  return rang === undefined ? GLOSSARY_SCHEMAS[id] : SCHEMAS[rang];
}
