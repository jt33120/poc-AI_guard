# Preuves locales de livraison

État vérifié le 23 septembre 2026 sur la branche locale `feat/glossary-threat-visuals`, à partir du commit `29d2a8a7af8769978a9434167c71ca3d80ff709d`. Le travail Developer Guard décrit ici n’est pas encore commité, publié au Marketplace ni déployé.

## Extension et runner

- `npm run verify` dans `secret-guard/` est vert : formatage, lint, types, build, contrats CLI/hooks, hôte VS Code, paquet, évaluation synthétique, fuzz, dogfood, performances et audit.
- Vitest : **29 fichiers**, **388 tests réussis**, **4 ignorés** ; couverture TypeScript mesurée à **94,19 % des instructions** et **86,68 % des branches**.
- Le test d’hôte démarre réellement **VS Code 1.137.0 sur macOS** et exécute **4 contrats** de l’extension.
- Le VSIX contient **9 fichiers exactement**, sans SBOM, provenance, reçu de hook ni artefact de test accidentel ; taille observée : **89 759 octets**.
- Évaluation déterministe : **1 150 positifs**, **50 000 mutations négatives**, **100 000 cas de fuzz** et **20/20 familles de détecteurs** exercées. Ces chiffres sont synthétiques et n’établissent pas les performances sur une population réelle.
- Dogfood : **81 fichiers**, **0 blocage**. Audit npm : **0 vulnérabilité**. Mesures observées lors de la porte finale : p95 **1,44 ms** à 16 Kio, **19,73 ms** à 256 Kio, **79,87 ms** à 1 Mio ; démarrage CLI p95 **62,04 ms**.

## Backend et contrats partagés

- `uv run pytest -q --maxfail=1` est vert sur **1 281 scénarios collectés**, avec **91 % de couverture Python**.
- Ruff, format Ruff et mypy strict sont verts sur **123 fichiers source**.
- L’audit statique rapporte **0 critique, 0 avertissement**. La barrière de souveraineté inspecte **40 modules** du chemin de décision sans sortie réseau non déclarée.
- La barrière de couverture prouve **9 facettes Bloqué** ; les générateurs de menaces et de couverture produit sont à jour sur **77 entrées** ; le registre de surcoût reste inchangé sur **5 chemins et 15 connexions**.
- Les migrations 0035–0036, l’adoption d’une base pré-ledger, les politiques Ed25519, l’affectation par poste, les approbations à usage unique, l’isolation tenant et la posture sans contenu sont incluses dans cette passe complète.

## Console et site

- Next.js **16.3.6** : lint sans erreur, typecheck vert, build de production vert sur **38 routes** et audit npm à **0 vulnérabilité**.
- Playwright : **80/80 scénarios réussis**, après un build de production. Le système de design ajoute **4/4 contrats** de tokens, contraste et sémantique.
- Les parcours couvrent notamment les politiques Developer Guard, les postes et motifs de posture, les approbations, l’échappement XSS, les états sans session, les 77 menaces, les langues et les largeurs 390/768/1440.
- Le glossaire garde ses définitions localement ; la recherche sémantique optionnelle retombe sur le filtre lexical en cas d’indisponibilité.
- Les nouvelles pages `/developpeurs`, `/developpeurs/securite` et `/developpeurs/tarifs` ont fait l’objet de deux séries de captures aux largeurs **390/768/1440**. La seconde série donne neuf réponses 200, **0 débordement horizontal** et **0 erreur console**. Les filtres produit/module/assistant/environnement sont partageables par URL et lisent le registre généré.
- Le lint visuel ciblé des nouveaux écrans n’introduit aucune couleur littérale ni seconde palette. Le scan historique global reste en alerte sur **208 erreurs** et **208 avertissements**, principalement dans `globals.css`, les anciens écrans Tailwind et le CSS de tokens généré ; ce passif n’est pas présenté comme résolu par cette livraison.
- `make verify` a terminé par `verify: OK` après les **1 281** tests Python, les audits, générateurs, contrôles frontend et la vérification complète Secret Guard.

## Frontières de la preuve

Ces preuves valident le dépôt local et les contrats simulés. Elles ne prouvent pas encore l’installation administrée par MDM, les cellules physiques Windows/Linux, une session Claude/Codex facturée par abonnement, l’isolation réseau du client, la publication Marketplace, ni un déploiement de la console. Ces cellules restent « à qualifier » dans `IMPLEMENTATION-STATUS.md` et `HOST-CAPABILITIES.md`.
