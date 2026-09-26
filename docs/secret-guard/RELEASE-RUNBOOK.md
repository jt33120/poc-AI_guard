# Runbook de release

1. Fournir `DEVELOPER_POLICY_SIGNING_KEY` au secret manager : une graine Ed25519 encodée base64 de 32 octets. Ne jamais la mettre dans PostgreSQL, le VSIX ou un fichier de politique.
2. Exécuter `npm --prefix secret-guard run verify`, puis construire le VSIX.
3. Vérifier le checksum et le contenu du VSIX ; générer SBOM/provenance dans le CI protégé.
4. Installer sur un profil VS Code propre et enregistrer les preuves de contrat avec données synthétiques.
5. Publier d’abord le canal pilote. La publication Marketplace est une observation distincte de la génération d’un VSIX.
6. Pour un rollback, revenir à l’artefact signé précédent ; ne pas rétrograder silencieusement la politique ni désactiver le scanner.

## Frontend

Le 23 septembre 2026, le frontend a été migré vers Next.js 16.3.6 et ESLint 9 ; `npm audit` ne rapporte plus de vulnérabilité. La migration adapte les cookies et paramètres de routes aux API asynchrones de Next 16. Le build, le typecheck et les parcours Playwright doivent rester dans les preuves de chaque release.

## Réglages sur mesure xSOM : cérémonie de clé d’autorité

Un réglage sur mesure (contrat `secret-guard/contracts/RULES-PACK.md`) n’est accepté par l’extension officielle que s’il est signé par une clé d’autorité xSOM **compilée dans la build**. L’extension ne fait jamais confiance à une clé transportée par l’enveloppe, ni à une clé lue sur le poste. C’est ce qui rend le réglage non contrefaisable.

| Valeur | Nature | Où elle va | Où elle ne va jamais |
|---|---|---|---|
| Graine Ed25519 (32 octets, base64) | **secrète** | secret de la plateforme AI Guard `XSOM_RULES_SIGNING_KEY` ; copie hors ligne | dépôt, CI de l’extension, ticket, journal, VSIX |
| Clé publique brute (32 octets, base64) | publique | variable du dépôt GitHub `XSOM_RULES_AUTHORITY_KEYS` | — |
| `keyId` (SHA-256 hex de la clé publique) | publique | journal de cérémonie, enveloppes signées | — |

### Générer la clé (une fois, par le propriétaire)

1. Sur un poste de confiance, depuis la racine du dépôt : `node secret-guard/scripts/generate-rules-authority-key.mjs` (option `--out <fichier>` pour choisir l’emplacement). Le script refuse d’écrire dans le dépôt et n’écrase jamais une graine existante ; par défaut il écrit `~/.xsom/rules-authority/rules-authority-<date>-<keyId>.seed` en 0600.
2. Déposer le contenu du fichier `.seed` dans le gestionnaire de secrets de la plateforme sous `XSOM_RULES_SIGNING_KEY`. Garder une copie chiffrée hors ligne.
3. Créer la variable de dépôt `XSOM_RULES_AUTHORITY_KEYS` (Settings → Secrets and variables → Actions → Variables) avec la clé publique affichée.
4. Consigner la date, le `keyId` et les personnes présentes. Ne jamais coller la graine dans ce journal.

Le workflow `secret-guard-release.yml` lit cette variable, la compile dans l’extension et le hook, et **échoue** si elle est absente : une release sans clé refuserait tout réglage. L’inspection du VSIX échoue aussi si une clé configurée manque à un bundle, ou si la clé publique de TEST des vecteurs du contrat s’y trouve.

### Rotation

1. Générer une nouvelle clé (étapes 1 à 4).
2. Mettre `XSOM_RULES_AUTHORITY_KEYS` à `"<nouvelle>,<ancienne>"` et publier une release : elle accepte les deux.
3. Attendre que le parc ait la nouvelle build (posture `runner_version`), puis basculer la plateforme sur la nouvelle graine : les réglages sont re-signés à la version suivante.
4. Retirer l’ancienne clé de la variable et publier. Détruire l’ancienne graine.

En cas de compromission de la graine : retirer immédiatement l’ancienne clé de la variable, publier une release, re-signer tous les réglages avec une nouvelle clé. Les postes qui n’ont pas mis à jour l’extension acceptent encore l’ancienne clé jusqu’à la mise à jour : la révocation passe par la release.

### Builds de développement et de test

Sans `XSOM_RULES_AUTHORITY_KEYS`, `packages/vscode/build.mjs` annonce « no key — this build refuses every rules pack » et l’extension affiche « Réglage indisponible : build sans clé xSOM ». Les tests utilisent la clé de TEST publique des vecteurs du contrat, uniquement avec `XSOM_RULES_TEST_BUILD=1` ; la suite Extension Host reconstruit l’extension sans elle à la fin.
