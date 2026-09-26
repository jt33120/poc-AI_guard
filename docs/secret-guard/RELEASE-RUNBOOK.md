# Runbook de release

1. Fournir `DEVELOPER_POLICY_SIGNING_KEY` au secret manager : une graine Ed25519 encodée base64 de 32 octets. Ne jamais la mettre dans PostgreSQL, le VSIX ou un fichier de politique.
2. Exécuter `npm --prefix secret-guard run verify`, puis construire le VSIX.
3. Vérifier le checksum et le contenu du VSIX ; générer SBOM/provenance dans le CI protégé.
4. Installer sur un profil VS Code propre et enregistrer les preuves de contrat avec données synthétiques.
5. Publier d’abord le canal pilote. La publication Marketplace est une observation distincte de la génération d’un VSIX.
6. Pour un rollback, revenir à l’artefact signé précédent ; ne pas rétrograder silencieusement la politique ni désactiver le scanner.

## Frontend

Le 23 septembre 2026, le frontend a été migré vers Next.js 16.3.6 et ESLint 9 ; `npm audit` ne rapporte plus de vulnérabilité. La migration adapte les cookies et paramètres de routes aux API asynchrones de Next 16. Le build, le typecheck et les parcours Playwright doivent rester dans les preuves de chaque release.
