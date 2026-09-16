/**
 * Quelle figure explique quelle fiche du glossaire.
 *
 * Les figures du dépôt sont indexées par **rang de menace** (`lib/schemas.ts`) et le
 * glossaire par **identifiant de fiche** : il en retient huit, choisies pour ce
 * qu'elles apprennent, là où le classement en range vingt-trois par coût. Le
 * rapprochement devait donc être écrit quelque part, et justifié : deux rangs
 * partagent parfois le même code OWASP, et une fiche décrit parfois un mécanisme que
 * le classement découpe autrement.
 *
 * Il se fait sur le **mécanisme que la fiche décrit**, jamais sur le code OWASP
 * qu'elle cite : c'est la définition et l'exemple que le lecteur a sous les yeux, et
 * une figure qui dessinerait le voisin lui apprendrait le voisin.
 */

import { GLOSSARY_SCHEMAS } from "@/lib/glossary-schemas";
import { SCHEMAS } from "@/lib/schemas";

/** Le rang dont la figure explique la fiche, et la raison de ce rang-là. */
const RANG: Record<string, number | undefined> = {
  // Une donnée interne collée dans un assistant public se disperse : c'est
  // exactement l'exemple de la fiche.
  "fuite-de-donnees": 4,
  // La fiche définit du code intégré « sans validation suffisante » et son réflexe
  // est de relire. Le rang 5, qui porte pourtant le code LLM05 qu'elle cite, dessine
  // une sortie de modèle exécutée par la machine : ce n'est pas la même faute.
  "code-vulnerable": 10,
  // L'exemple de la fiche est un document à résumer qui porte une consigne cachée,
  // donc l'injection indirecte. Le rang 8 dessine la directe.
  "injection-de-prompt": 1,
  // Le titre du rang est celui de la fiche, mot pour mot.
  "autonomie-excessive": 2,
  // Seul rang de la chaîne d'approvisionnement.
  "dependances-compromises": 12,
  // Seul rang de l'empoisonnement de données.
  empoisonnement: 15,
  // La décision prise sur un fait inventé, sans qu'aucun contrôle ne se déclenche.
  hallucinations: 11,
  // `acces-rag` n'est pas ici : aucun rang ne dessine son mécanisme. Le seul
  // voisin, le rang 16, parle de cloisonnement entre clients quand la fiche parle
  // des droits de la personne qui interroge. Sa figure est écrite à part.
};

/** Le corps SVG qui explique cette fiche, ou rien si aucune ne lui correspond. */
export function figureDeFiche(id: string): string | undefined {
  const rang = RANG[id];
  return rang === undefined ? GLOSSARY_SCHEMAS[id] : SCHEMAS[rang];
}
