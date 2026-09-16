/**
 * Les figures du glossaire qu'aucun rang ne pouvait fournir.
 *
 * Les figures du dépôt vivent dans `lib/schemas.ts`, indexées par **rang de menace** :
 * le garde y refuse toute clé qui ne soit pas un rang du classement, et une figure sans
 * menace en face y est du balisage relu et payé pour rien. Le glossaire, lui, est indexé
 * par **identifiant de fiche** et n'en retient que huit, choisies pour ce qu'elles
 * apprennent. Une figure écrite pour une fiche n'a donc pas de place dans `schemas.ts`,
 * et c'est la seule raison de ce fichier : même grammaire, même garde
 * — `tests/test_schemas_menaces.py` lit les deux — mais un autre index.
 *
 * `acces-rag` est le premier cas. Le seul rang qui en approche, le 16, dessine un index
 * vectoriel partagé où la requête d'un CLIENT lit la partition d'un autre : son sujet est
 * le cloisonnement entre clients. La fiche parle d'autre chose, les droits de la PERSONNE
 * qui interroge — un salarié à qui l'assistant cite un dossier qu'il ne peut pas ouvrir.
 * Les deux ont le même code OWASP et ne s'apprennent pas ensemble : publier le 16 sous
 * cette fiche aurait enseigné la menace voisine, ce qui coûte plus cher qu'une case vide.
 * Le lecteur serait reparti en croyant avoir compris.
 */

export const GLOSSARY_SCHEMAS: Record<string, string> = {
  "acces-rag": `
    <title>La recherche ne rejoue pas les droits du salarié : le dossier interdit lui est cité.</title>
    <rect class="d" x="126" y="32" width="68" height="48" rx="2"/>
    <rect class="n" x="6" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="28" y="61" text-anchor="middle">Salarié</text>
    <line class="f" x1="50" y1="58" x2="62" y2="58" marker-end="url(#fx)"/>
    <rect class="n" x="64" y="46" width="52" height="24" rx="2"/>
    <text class="t" x="90" y="61" text-anchor="middle">Assistant</text>
    <line class="f" x1="116" y1="58" x2="130" y2="58" marker-end="url(#fx)"/>
    <rect class="n n--hot" x="132" y="46" width="56" height="24" rx="2"/>
    <text class="t t--hot" x="160" y="61" text-anchor="middle">Dossier RH</text>
    <text class="t" x="160" y="92" text-anchor="middle">Base RAG</text>
    <line class="f" x1="90" y1="70" x2="90" y2="80" marker-end="url(#fx)"/>
    <line class="x" x1="80" y1="75" x2="100" y2="75"/>
    <rect class="n" x="64" y="82" width="52" height="24" rx="2"/>
    <text class="t" x="90" y="97" text-anchor="middle">Ses droits</text>
    <path class="a a-move" d="M160 46 L160 16 L28 16 L28 44" marker-end="url(#ax)"/>
    <text class="t t--hot" x="95" y="12" text-anchor="middle">dans la réponse</text>
  `,
};
