# État d’implémentation Developer Guard

État vérifié localement le 23 septembre 2026. « Implémenté » décrit le code et ses tests dans ce dépôt. « À qualifier » demande un hôte, un OS administré ou une infrastructure externe et ne doit pas être présenté comme livré en production.

| Lot | État local | Preuve dans le dépôt | Qualification restante |
|---|---|---|---|
| T00 | implémenté | `HOST-CAPABILITIES.md`, `EVIDENCE-PROTOCOL.md`, documentation V0 réconciliée | sessions réelles Claude/Codex et cellules Windows/Linux |
| T01 | implémenté | schémas/fixtures partagés, évaluateurs TS/Python et tests de conformité | aucune pour le contrat local |
| T02 | implémenté | adaptateurs Claude/Codex/Copilot, entrées invalides et capacités non vérifiées refusées | invocation effective par chaque version d’hôte |
| T03 | implémenté | politique de données, résolution de chemins, limites binaire/taille/symlink | course entre validation et lecture hors sandbox |
| T04 | implémenté | classification d’actions/outils/commandes, pipes, interpréteurs et PTY testés | commandes arbitraires hors environnement renforcé |
| T05 | implémenté | enveloppes Ed25519, RLS/RBAC, enrôlement, cache, révocation, anti-downgrade et version minimale | injection de la clé privée et rotation opérée en environnement cible |
| T06 | implémenté | approbation liée au poste, à la politique, à l’action et consommée atomiquement | parcours humain déployé avec SLA réel |
| T07 | implémenté sur les chemins raccordés | empreinte MCP, dérive de schéma, relais Claude existant et tests de nettoyage | Codex/Copilot ne passent pas par ce relais ; session abonnement réelle à prouver |
| T08 | implémenté | posture de politique/hook/version/file, journal sans contenu et état périmé non vert | déclaration client, sans attestation matérielle |
| T09 | implémenté | publication/affectation, posture par poste, lien d’exception, erreurs/vides/XSS en Playwright | déploiement console relié à un poste réel |
| T10 | pilote Linux implémenté ; profils macOS/Windows fournis | `deploy/developer-guard`, tests structurels et syntaxiques | essais physiques, MDM et preuve réseau avant badge Renforcé |
| T11 | mécanisme d’intégration implémenté | ingestion SARIF 2.1.0, reçus commit/moteur, gate CI, fixtures pass/fail/malformée | choisir et qualifier un moteur tiers selon licence/confidentialité |
| T12 | implémenté | couverture produit générée, 77 menaces générées via AST TypeScript, contrôles de cohérence | ajouter uniquement les preuves d’hôtes réellement exécutées |
| T13 | implémenté pour l’artefact | workflow VSIX, SBOM CycloneDX, provenance, checksums, pilote/stable et runbooks | publication Marketplace, droits de branche et support contractuel |
| T14 | validé localement | suites ciblées/complètes consignées dans `RELEASE-EVIDENCE.md`, handoff Astra | installation pilote, parcours Claude/Codex réels, URL/SHA déployés |
| A01 | implémenté et validé localement | routes `/developpeurs`, `/developpeurs/securite`, `/developpeurs/tarifs`, navigation publique et liens depuis accueil/produits/extension | URL/SHA de publication après autorisation |
| A02 | implémenté et validé localement | scénario synthétique secret/action destructive/réseau, profils Local/Équipe/Renforcé, aucun appel externe | confrontation aux hôtes et postes réels du pilote |
| A03 | implémenté et validé localement | registre produit généré, modes B/D/O/A/X, préconditions/limites, filtres partageables produit/module/assistant/environnement | enrichir uniquement depuis de nouvelles preuves exécutées |
| A04 | validé localement | FR/EN, clavier, focus, reduced motion, 390/768/1440, 0 débordement, 0 erreur console sur les neuf captures, 80/80 Playwright | lecteur d’écran matériel et publication distante à qualifier |

Les protections locales de secrets restent actives sans droit commercial. Une expiration de licence ne doit ni désactiver le scanner ni ouvrir une permission. L’extension conserve l’identifiant Marketplace existant ; aucune publication distante n’a été effectuée par cette implémentation.
