# ADR-0002 — Expurger sans compte : un relais local dans Secret Guard

> **Statut : Accepté (D1 à D4 validées le 2026-10-01).**
> **Date : 2026-10-01.**
> **Contexte :** en mode Expurger, Secret Guard bloque le prompt au lieu de le
> nettoyer, sauf si le poste est raccordé à la passerelle xSOM. On veut une purge
> transparente, gratuite et open source, sans serveur xSOM.

## 1. Problème

- Un hook ne fait que laisser passer ou bloquer. Claude Code ne lui permet pas de
  modifier le prompt (`UserPromptSubmit`) ni un fichier lu (`PreToolUse` sur Read).
- Sans passerelle, Expurger se traduit donc par un blocage, puis une purge du
  presse-papiers que l'utilisateur doit recoller. Les captures d'écran que Claude
  lit sont bloquées aussi : le hook ne sait pas analyser une image.
- La purge transparente n'existe qu'avec la passerelle xSOM, donc avec un compte.

**Objectif.** Pour Claude Code, nettoyer la requête sur le poste avant son envoi au
fournisseur, puis continuer : l'utilisateur voit « Prompt purgé » et la session ne
s'arrête pas.

## 2. Ce qui existe déjà

| Pièce | Où | Rôle actuel |
|---|---|---|
| Relais local | `packages/vscode/src/gateway-bridge.ts` | Écoute sur `127.0.0.1` derrière un chemin aléatoire. Transmet `/v1/messages` et `count_tokens` à la passerelle xSOM, sans rien modifier. |
| Nettoyage | `core/extension_redaction.py` (serveur, Python) | Parcourt le JSON Anthropic, remplace par `XXX`, rescanne. Transforme les images en texte (OCR serveur). |
| Délégation du hook | `gateway-delegation.ts`, `hook-entry.ts` | En mode Expurger, le hook laisse passer un prompt ou une lecture de fichier si la session passe par un relais vivant. |
| Détection locale | `packages/core` (TypeScript, Apache 2.0) | `scan`, `redactAndRescan` : déterministe, sans dépendance, 1 Mio par entrée. |
| Branchement | `claudeCode.environmentVariables` | `ANTHROPIC_BASE_URL` pointe vers le relais pour les sessions Claude Code ouvertes dans VS Code. |

Le relais et la délégation existent. Seul l'endroit où se fait le nettoyage change.

## 3. Décision proposée

Un **relais local d'expurgation**. On garde le pont actuel, mais le nettoyage se fait
sur le poste avec le cœur TypeScript, et la requête part directement chez Anthropic.

```text
Claude Code (VS Code)
  → http://127.0.0.1:<port>/<capacité 256 bits>/v1/messages
  → relais local : lecture du JSON → XXX → nouveau scan (refus s'il reste un secret)
  → https://api.anthropic.com/v1/messages  (adresse fixe, sans redirection)
  ← réponse relayée telle quelle, en streaming
```

Côté hook : quand un secret est vu et que le relais local est vivant, le hook laisse
passer et affiche `🧹 Secret Guard · Prompt purgé avant envoi`. Ni la valeur, ni
son empreinte n'apparaissent.

**Le compte xSOM ne sert qu'à la preuve.** Expurger n'en a pas besoin. Un journal
gardé sur le poste ne prouve rien à un tiers, puisque son propriétaire peut le
modifier. L'offre payante garde donc le nettoyage en local : le relais envoie en
plus, à part, des métadonnées sans contenu (date, assistant, nombre de secrets
masqués par type) à xSOM, qui les chaîne, les horodate et en tire le relevé.
Ces métadonnées sont déclarées par le poste. La passerelle serveur actuelle reste
disponible pour qui veut que xSOM fasse lui-même le nettoyage.

## 4. Contrat de nettoyage

On reprend les règles de `core/extension_redaction.py`, appliquées avec le
détecteur TypeScript, celui du hook. Le hook et le relais voient donc la même chose.

- Champs inspectés : `messages` (historique compris), `system`, `tools`. Le modèle
  et les paramètres ne sont pas touchés.
- Chaque texte est scanné, ses secrets remplacés par `XXX`, puis il est rescanné.
  S'il reste un secret, la requête est refusée.
- Une clé d'objet sensible (`password`, `token`, `api_key`…) voit sa valeur
  remplacée par `XXX`.
- Les identifiants de protocole (`type`, `role`, `id`, `tool_use_id`, `name`) ne
  sont jamais modifiés : un secret à cet endroit fait refuser la requête.
- Un bloc `thinking` signé est relayé tel quel s'il est propre. S'il contient un
  secret, la requête est refusée : on ne peut pas modifier un bloc signé.
- `count_tokens` est nettoyé de la même façon. Sinon, ce chemin enverrait le
  secret au fournisseur.
- Sortie déterministe : une même entrée donne les mêmes octets, pour que le cache
  de prompt d'Anthropic continue de fonctionner.
- Refus explicite avec une erreur au format Anthropic, que Claude affiche :
  « Secret Guard a refusé l'envoi : … ». Cas de refus : JSON invalide, profondeur
  supérieure à 40, requête de plus de 16 Mio, bloc de texte de plus de 1 Mio, scan
  incomplet. Jamais de suffixe non scanné transmis (CLAUDE.md §4.11).
- La réponse du modèle est relayée sans analyse en v1.
- Rien n'est écrit sur disque : ni prompt, ni valeur, ni empreinte. Seuls les
  compteurs par type sont conservés, pour l'affichage.

## 5. Sécurité

- Écoute sur `127.0.0.1` seulement, port aléatoire, capacité de 256 bits dans le
  chemin, requête refusée si elle porte un en-tête `Origin` ou un `Host` inattendu
  (protection contre le DNS rebinding). C'est déjà en place dans le pont actuel.
- Destination fixe dans le code, `https://api.anthropic.com`, avec
  `redirect: "error"`. Elle n'est pas configurable en mode local : le relais ne
  peut pas servir à exfiltrer.
- `authorization`, `x-api-key`, `anthropic-version` et `anthropic-beta` sont
  relayés en mémoire, jamais écrits ni journalisés. L'abonnement Claude de
  l'utilisateur est conservé.
- Pas de repli direct : relais arrêté ou nettoyage impossible, la requête échoue.
  Elle ne part jamais en clair.
- Les hooks continuent de protéger Copilot, Codex et les sessions non raccordées.
- Hors périmètre : un logiciel malveillant déjà présent sur le poste.

## 6. Périmètre et limites

- **v1 :** Claude Code dans VS Code. Il faut ouvrir une nouvelle session après
  l'activation : Claude lit `ANTHROPIC_BASE_URL` au démarrage.
- **Non couverts :**
  - Copilot et Codex : on ne peut pas changer leur destination.
  - Claude.ai et ChatGPT dans le navigateur.
  - `claude` lancé en terminal (piste v2 : une commande `secret-guard relay` sur un
    port fixe, fournie par la CLI).
- Un secret que le détecteur ne reconnaît pas passe, exactement comme avec le hook.
- Images : pas d'analyse locale. Il n'y a ni OCR ni modèle sur le chemin de
  détection (CLAUDE.md §3). Voir D1.

## 7. Licence

- Nouveau paquet `secret-guard/packages/relay/` (`@xsom/secret-guard-relay`) sous
  Apache 2.0. Il ne dépend que de `@xsom/secret-guard-core` et de `node:http`.
  On l'ajoute au périmètre open source de `LICENSING.md`, et
  `tests/test_licensing.py` vérifie qu'il n'importe aucun code commercial.
- L'extension VS Code, sous licence commerciale, se contente de démarrer le relais,
  d'écrire `ANTHROPIC_BASE_URL` et d'afficher l'état.
- Restent payants : le journal du relais, le relevé PDF, les politiques signées et
  la console, c'est-à-dire tout ce qui passe par xSOM.

## 8. Critères d'acceptation (tests)

Tous les tests utilisent un faux fournisseur local, jamais Anthropic.

1. Le corps reçu par le fournisseur contient `XXX` à la place du secret, dans le
   prompt, l'historique, `system`, un `tool_result` et une clé sensible.
2. Streaming SSE relayé octet pour octet ; `count_tokens` nettoyé.
3. Refus attendus : JSON invalide, profondeur, tailles, secret résiduel, secret dans
   un `tool_use_id`, `thinking` signé contenant un secret. Le fournisseur ne reçoit
   rien.
4. `403` sans la capacité, avec un en-tête `Origin` ou avec un `Host` inattendu ;
   `502` sans repli quand le fournisseur est injoignable.
5. Les en-têtes d'authentification arrivent au fournisseur et n'apparaissent dans
   aucun log ni aucune erreur.
6. Deux envois identiques donnent un corps nettoyé identique (cache de prompt).
7. Hook : avec le relais vivant en mode Expurger, un prompt contenant un secret
   passe et affiche « Prompt purgé avant envoi » ; relais arrêté, il est bloqué
   comme aujourd'hui.
8. Latence : seuil intégré au benchmark existant (`benchmark:check`) ; valeur à
   fixer, voir D4.
9. `npm --prefix secret-guard run verify` vert, contenu du VSIX vérifié.

## 9. Décisions (validées le 2026-10-01)

| # | Question | Recommandation |
|---|---|---|
| D1 | Images dans la requête (captures que Claude lit) | Réglage **Images non analysées** : *Refuser* par défaut, conformément à §4.11 ; *Laisser passer en le signalant* sur choix explicite, avec un message à chaque fois. |
| D2 | Activation | La proposer une fois quand l'utilisateur choisit Expurger et que Claude Code est installé, avec une phrase claire : « vos requêtes Claude passeront par un relais sur ce PC ». Pas de bascule silencieuse d'un réglage de Claude. |
| D3 | Blocs `redacted_thinking` (chiffrés par Anthropic) | Les relayer tels quels. Ils viennent du modèle, sont chiffrés et ne contiennent aucune saisie en clair. Le serveur les refuse aujourd'hui, ce qui coupe des sessions. |
| D4 | Budget de texte total par requête | Plafond de 1 Mio par bloc, et un plafond total fixé après mesure, pour qu'une longue session ordinaire ne soit jamais refusée. Le serveur limite à 1 Mio au total, trop bas pour Claude Code. |

## 10. Découpage

1. **Lot 1 — paquet `relay`** : nettoyage, serveur local, erreurs, tests 1 à 6 et 8.
2. **Lot 2 — extension** : démarrage et arrêt, `ANTHROPIC_BASE_URL`, protocole de
   santé `xsom-local-redaction-v1`, délégation du hook avec le message « Prompt
   purgé » (test 7), état affiché dans le panneau.
3. **Lot 3 — finition** : réglage Images (D1), `LICENSING.md`, documentation,
   CHANGELOG, release.
