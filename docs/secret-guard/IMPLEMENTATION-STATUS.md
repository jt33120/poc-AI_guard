# État d’implémentation Developer Guard

État vérifié localement le 23 septembre 2026, complété le 27 septembre 2026 pour les réglages sur mesure (extension 0.7.0, branche `feat/secret-guard-regles-xsom`, non publiée). « Implémenté » décrit le code et ses tests dans ce dépôt. « À qualifier » demande un hôte, un OS administré ou une infrastructure externe et ne doit pas être présenté comme livré en production.

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
| R01 | implémenté et validé localement (extension 0.7.0) | contrat figé `secret-guard/contracts/RULES-PACK.md` et ses vecteurs (tous passent en TypeScript) ; cœur : motifs sûrs compilés et interprétés avec budget, termes en empreintes salées, validité et auto-tests ; runner : clés d’autorité compilées, tenant enrôlé, anti-retour, expiration signalée ; extension : synchronisation, revérification par le hook, posture §7, infobulle et centre de protection ; cérémonie de clé, porte de latence avec le plus grand réglage, `CLAIMS.md` | cérémonie de clé par le propriétaire et variable `XSOM_RULES_AUTHORITY_KEYS` ; route `GET /v1/extension/rules-pack` et champs d’événement §7 déployés par la plateforme ; `tenant_id` renvoyé à l’enregistrement (sinon premier réglage épinglé) ; premier réglage réel en pilote |
| R02 | corrigé | pont d’approbation : socket court et privé sur macOS (le chemin dépassait 104 octets, `listen EINVAL`) ; suite Extension Host isolée du trousseau macOS | — |
| A04 | validé localement | FR/EN, clavier, focus, reduced motion, 390/768/1440, 0 débordement, 0 erreur console sur les neuf captures, 80/80 Playwright | lecteur d’écran matériel et publication distante à qualifier |

Les promesses visibles et leurs preuves sont tenues dans [`CLAIMS.md`](CLAIMS.md), avec les corrections de texte recommandées pour le site.

**Réglages sur mesure, 27 septembre 2026.** `npm --prefix secret-guard run verify` est vert : 40 fichiers de tests, 578 tests réussis (4 ignorés), contrats CLI/hooks, Extension Host VS Code 1.137.0 (5 contrats, dont le réglage), VSIX de 10 fichiers sans clé de TEST, évaluation synthétique, fuzz, dogfood (93 fichiers, 0 blocage), latence et audit npm (0 vulnérabilité). Une revue adverse en quatre couches (chasse aveugle, cas limites, écarts de vérification, audit d’acceptation) a conduit aux correctifs : relais jamais utilisé pour une détection sur mesure ou une analyse incomplète, budget unique par décision de hook, caractères invisibles, étiquettes assainies, historique par (tenant, packId), écritures atomiques et fusionnées, tenant de politique revérifié, champs §7 retirés tant que la plateforme ne sert pas la route. Restent ouverts, sans promesse associée : l’enrôlement passe par le raccordement Claude (un poste Codex/Copilot seul ne synchronise pas de réglage), le retrait `{"rulesPack": null}` n’est pas signé, l’état local du poste (tenant, historique, empreinte auto-testée) n’est pas authentifié, et un hook qui refuse le réglage stocké ne le signale pas à la posture.

Les protections locales de secrets restent actives sans droit commercial. Une expiration de licence ne doit ni désactiver le scanner ni ouvrir une permission. L’extension conserve l’identifiant Marketplace existant ; aucune publication distante n’a été effectuée par cette implémentation.
