# Livraison frontend Astra

Ce document décrit ce que le frontend de présentation affirme après l’implémentation et la validation locales de Developer Guard.

## Proposition de valeur vérifiable

« Vos développeurs utilisent leurs agents de code. Votre entreprise définit les données et les actions autorisées, puis vérifie les contrôles appliqués sur les chemins raccordés. »

Une seule extension conserve l’identifiant `xsom.xsom-secret-guard-vscode`. Elle regroupe Secret Guard Local et les fonctions Developer Guard activées par politique. La console existante gère les postes, politiques, postures et exceptions à usage unique.

## États à afficher

- **Disponible localement** : scanner Secret Guard, contrats de politique, runner déterministe, console et audit sans contenu.
- **Pilote** : gestion d’équipe, relais Claude et session Linux renforcée, après installation administrée dans l’environnement du client.
- **À qualifier** : interception réelle Claude/Codex par version, profils physiques macOS/Windows, Remote/WSL/Containers, publication Marketplace.
- **Hors promesse** : protection universelle de VS Code, détection sémantique exhaustive, navigateur personnel, processus lancé hors session renforcée.

## Données à consommer

La couverture produit vient exclusivement de `frontend/lib/generated/product-coverage.json`, généré depuis `coverage/developer-guard-controls.json` et le glossaire. Les 77 menaces et outils candidats sont reconstruits par `scripts/gen_threat_backend_brainstorm.mjs`. Aucun badge ou compteur ne doit être saisi en dur.

Les modes de preuve sont traduits ainsi : B = bloqué sur un chemin prouvé ; D = détecté ; O = contrôle tiers orchestré ; A = posture attestée ou déclarée selon sa provenance ; X = hors périmètre. Une preuve MCP ne devient pas une preuve VS Code.

## Scénarios synthétiques

1. Un prompt contient un jeton synthétique : le scanner refuse ou expurge selon le mode, puis rescane avant transmission.
2. L’agent demande une lecture sensible ou une publication : la politique refuse ou exige une approbation liée à l’action exacte.
3. Un hook est modifié ou n’est plus invoqué : la posture passe à « À vérifier » et explique la dérive sans exposer de prompt, chemin ou secret.

Chaque démonstration doit être étiquetée comme simulation ou replay local. Les captures doivent employer un tenant, des postes et des secrets synthétiques.

## Prix et économie

Les fourchettes du plan sont des hypothèses de test, pas un tarif publié. Séparer le prix du fournisseur de modèles, la licence xSOM, le déploiement et le support. Ne jamais afficher un pourcentage d’économie sans données client mesurées et approuvées.

## Défauts et limites à conserver visibles

- Les timeouts et priorités de hooks dépendent des contrats fournisseurs.
- Le profil Local est retirable par l’utilisateur ; le profil Équipe dépend de l’administration du poste.
- Seul Linux possède une référence d’isolation dans ce dépôt.
- La posture de l’extension est une déclaration client ; l’audit distingue les observations de la passerelle.
- Aucune URL de production, publication Marketplace ou session fournisseur réelle n’est prouvée dans ce handoff.

## Validation Astra effectuée

Les pages `/developpeurs`, `/developpeurs/securite` et `/developpeurs/tarifs` sont implémentées dans le système Signal existant. Elles distinguent les niveaux Local, Équipe et Renforcé, simulent trois scénarios sans appel externe, lisent le registre produit généré et présentent un simulateur dont chaque hypothèse reste modifiable.

La revue visuelle a été exécutée en deux passes à 390, 768 et 1440 px sur les trois routes : neuf réponses HTTP 200, aucun débordement horizontal et aucune erreur console. Le registre, initialement trop long, affiche maintenant huit lignes puis une action explicite pour poursuivre. Les tests couvrent clavier, focus, reduced motion, FR/EN, liens profonds et URL de filtres partageables. Le lien d’installation conduit au parcours VSIX existant, dont l’artefact est contrôlé séparément.

Le lecteur d’écran matériel, la publication distante et les URL/SHA de production restent à qualifier. Après publication autorisée, consigner séparément l’URL, le SHA et le parcours réellement testé.
