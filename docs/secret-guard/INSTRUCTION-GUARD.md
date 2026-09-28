# Instruction Guard — les consignes cachées dans ce que lit l’agent

**Statut : lot 1 livré (détecteur, hook, CLI) · 28 septembre 2026**

## 1. La menace

Un assistant de code lit du texte que le développeur ne voit pas en entier. Quatre
porteurs d’instructions invisibles sont documentés publiquement contre les assistants
de code :

| Porteur | Attaque | Ce que voit l’humain | Ce que lit le modèle |
|---|---|---|---|
| Caractères d’étiquette Unicode (U+E0000–E007F) | « ASCII smuggling » : chaque étiquette reflète un caractère ASCII | rien | une consigne complète |
| Contrôles bidirectionnels (U+202A–202E, U+2066–2069) | « Trojan Source », CVE-2021-42574 | un texte réordonné | un autre ordre, donc une autre consigne |
| Caractères de largeur nulle en série | « Rules File Backdoor » : des bits entre les lettres | rien | des données encodées |
| Sélecteurs de variante en série | « emoji smuggling » : un octet par sélecteur | un emoji | un message |

Le vecteur le plus rentable pour un attaquant est un **fichier de consignes** : `AGENTS.md`,
`CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`, `.mcp.json`… Il arrive par
une pull request, un template ou un paquet, passe la revue parce qu’il paraît anodin, puis
l’assistant le charge et suit ce qu’il n’affiche pas.

## 2. Ce que le produit couvrait déjà, et ce qui manquait

Secret Guard traitait déjà les caractères invisibles, mais **pour une autre raison** :
`SG-T14` les retire avant la détection pour qu’ils ne cachent pas un secret. Rien ne
signalait qu’un texte **portait** des caractères invisibles. Un prompt ou un fichier sans
secret mais chargé d’une consigne en étiquettes Unicode passait tel quel.

`docs/secret-guard/DEVELOPER-THREAT-MAPPING.md` ne mentionnait pas cette famille.

## 3. Le produit

**Instruction Guard** est une capacité de Secret Guard, sur le même moteur local :
déterministe, hors ligne, sans modèle de langage, ni réseau pendant l’analyse. Il est
livré dans l’édition Local, gratuite et open source (Apache 2.0, comme le détecteur et la
CLI).

| Chemin | Ce qui se passe |
|---|---|
| Prompt soumis (hooks natifs Claude Code, Codex, Copilot) | Bloquer / Expurger : envoi arrêté, avec le nombre, le type et la position ; Avertir : message et passage |
| Fichier lu par l’outil Read, ou mentionné en `@` | Même verdict, fichier par fichier |
| Fichiers de consignes du dépôt (chargés sans hook) | `secret-guard instructions` les trouve, `--fix` les nettoie, code de sortie pour la CI et les hooks Git |
| Texte collé | `pbpaste \| secret-guard instructions --fix - \| pbcopy` |

Le message qui bloque atteint l’assistant : il ne contient **jamais** ce que les
caractères épellent, seulement leur nombre, leur type et leur position.

**Faux positifs évités par construction :** drapeaux de subdivision (🏴 Angleterre),
emoji composés (ZWJ), jointures des écritures arabe, persane, indiennes, mongole, marques
directionnelles LRM/RLM, un sélecteur de variante après sa base, BOM initial, trait
d’union conditionnel isolé, et jusqu’à trois caractères invisibles épars (bruit de
copier-coller).

**Édition Équipe (suite)** : politique d’organisation pour imposer le contrôle en CI et au
poste, événements d’audit sans contenu, gabarits de pipeline.

## 4. Hors périmètre

- Détecter une injection de prompt **visible** : c’est une analyse sémantique, non-objectif
  explicite de Secret Guard (`CLAUDE.md` §2).
- Empêcher l’hôte de charger un fichier de consignes au démarrage de session : aucun hook
  ne le voit. D’où la commande `instructions` et le nettoyage avant commit.
- Homoglyphes (un « о » cyrillique à la place d’un « o ») : visibles, et hors lot 1.

## 5. Plan d’implémentation

| Lot | Contenu | État |
|---|---|---|
| 1 | Détecteur `findHidden` / `stripHidden` dans `@xsom/secret-guard-core` ; hook (prompt, Read, `@`) ; commande `secret-guard instructions [--fix] [--json] [chemin…\|-]` ; tests et contrats | **livré** |
| 2 | Extension VS Code : surveillance des fichiers de consignes du workspace, commande « Neutraliser les caractères invisibles », Expurger le presse-papiers qui retire aussi ces caractères | à faire, après la séparation Local/Équipe de l’extension |
| 3 | Équipe : règle de politique `hidden_instructions`, événement d’audit, gabarit GitHub Actions / pre-commit | à faire |
| 4 | Page Secret Guard du site et revendications adossées aux tests (`docs/secret-guard/CLAIMS.md`) | à faire |

## 6. Critères d’acceptation du lot 1

1. Les quatre porteurs sont détectés avec ligne et colonne ; les usages légitimes
   listés en §3 restent silencieux (`tests/core/hidden.test.ts`).
2. Aucun rapport, message de hook ni sortie CLI ne contient ce que les caractères
   épellent (tests et contrats subprocess).
3. Un prompt ou un fichier porteur est bloqué en Bloquer et Expurger, signalé en Avertir,
   par la CLI et par le hook livré dans l’extension (`scripts/test-cli.mjs`).
4. Un texte de plus de 1 Mio n’est jamais déclaré propre.
5. `secret-guard instructions` trouve les fichiers de consignes sans entrer dans
   `node_modules` ni `.git`, sort en `1` s’il trouve, `2` s’il n’a pas tout vérifié, et
   `--fix` réécrit atomiquement en gardant les usages légitimes.
6. `npm --prefix secret-guard run verify` vert : couverture du core, latence, VSIX.

## Sources publiques

- Pillar Security, « Rules File Backdoor », mars 2025.
- Johann Rehberger, « ASCII Smuggler », 2024.
- Boucher et Anderson, « Trojan Source », CVE-2021-42574, 2021.
- Paul Butler, « Smuggling arbitrary data through an emoji », février 2025.
