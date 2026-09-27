# Brief de reprise — Terra medium

Ce document prépare l'exécution ; il ne constitue pas une validation du plan par l'utilisateur.

## Prompt de lancement après validation

> Implémente le plan `docs/secret-guard/DEVELOPER-GUARD-PLAN.md`, avec le rattachement exhaustif `docs/secret-guard/DEVELOPER-THREAT-MAPPING.md`. Commence par T00, puis avance lot par lot. Conserve l'extension existante et son identifiant. Préserve les modifications locales étrangères. Ne prétends pas qu'un contrôle est actif à partir de sa seule configuration. Donne une preuve de l'effet du refus et un cas légitime passant. Mets à jour un état de reprise après chaque lot. Réserve la refonte du site public à Astra ; livre les interfaces de gestion fonctionnelles et les données de couverture nécessaires. Ne coche jamais une compatibilité ou une publication non vérifiée.

## Lecture initiale

1. `CLAUDE.md`, `docs/SPEC.md`, `docs/BUILD_PLAN.md` pour les invariants existants.
2. `DEVELOPER-GUARD-PLAN.md` pour le nouveau périmètre validé.
3. `DEVELOPER-THREAT-MAPPING.md` et `../menaces-backend-brainstorm.md` pour les menaces et candidats d'outillage.
4. `GATEWAY_AUDIT.md`, `attachments.md`, `secret-guard/README.md` pour les chemins déjà livrés et leurs limites.

Le plan validé fait évoluer certains anciens non-objectifs : réconcilier la documentation en T00, sans supprimer les invariants de sécurité. Utiliser graft pour l'orientation ciblée, puis lire seulement le code nécessaire.

## État de départ constaté

- Version de manifeste : 0.6.0 ; README et certaines promesses frontend en retard.
- Scanner, hooks prompts, lecture Claude, relais Claude et console de postes présents.
- La couverture actions multi-assistants, les politiques signées et le profil renforcé sont à construire/qualifier.
- Le brainstorming contient 77 menaces ; les outils cités sont candidats, pas intégrations existantes.
- Aucune implémentation produit réalisée pendant la planification.
- Modifications préexistantes observées dans `.claude/helpers/graft-hooks.cjs`, `.claude/helpers/graft-statusline.cjs`, `.claude/settings.json`, `.claude/skills/graft/SKILL.md` : ne pas les écraser ni les inclure sans revue.

## Invariants de livraison

- Aucun contenu sensible dans les logs, fixtures, diagnostics ou capture de démonstration.
- Pas de LLM obligatoire pour autoriser une action.
- Pas de permissions accordées via les instructions du dépôt ou les propos du modèle.
- Pas de blacklist shell présentée comme isolation.
- Pas de post-hook présenté comme prévention d'une action déjà exécutée.
- Pas de mode « protégé » si le hook expire en laissant passer ou si l'hôte/version n'a pas été testé.
- Pas d'accès direct de secours au fournisseur lorsqu'un chemin imposé refuse une requête.
- Pas de nouvelle clé API installée à la place de l'abonnement natif sans décision explicite.
- Pas de seconde base de connaissances sur la couverture dans le frontend : données générées à partir des tests.
- Les droits commerciaux ne peuvent pas ouvrir une permission refusée par la sécurité.

## Format de suivi par lot

Dans `IMPLEMENTATION-STATUS.md` : lot, état, périmètre, fichiers, tests réellement exécutés, résultat, preuve hôte réelle ou simulée, exclusions, prochaine étape. Documenter les dépendances qui empêchent une preuve sans les masquer derrière un test unitaire.

Exécuter les tests ciblés pendant le lot et les gates complets aux étapes prévues. Éviter de relancer toute la suite sans nouveau changement. `make verify` inclut déjà les vérifications Secret Guard : inutile de les répéter immédiatement si elles viennent de réussir et que rien n'a changé.

## Passage à Astra

À la fin de T14, remettre `RELEASE-EVIDENCE.md` et `ASTRA-HANDOFF.md` avec capacités réelles, versions/OS, données générées, limites, captures, parcours et disponibilité commerciale. Astra exécute A01–A04. Les noms définitifs, tarifs et promesses publiques ne sont pas déterminés par la seule existence d'un composant.
