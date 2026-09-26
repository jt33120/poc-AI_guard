# Rattachement des 77 menaces au produit développeur

22 septembre 2026. Annexe au [plan d'implémentation](DEVELOPER-GUARD-PLAN.md).

Source : [`../menaces-backend-brainstorm.md`](../menaces-backend-brainstorm.md), généré depuis `frontend/lib/threat-glossary.ts`. Tous ses identifiants sont répartis une fois dans le tableau ci-dessous. Il s'agit d'un classement de conception, sans attribution automatique de couverture actuelle.

Trois décisions : **socle** = traiter une facette développeur dans les lots prévus ; **option** = intégration ultérieure pour un usage spécifique ; **externe** = responsabilité d'un système complémentaire ou du fournisseur. Même « socle » ne signifie pas menace intégralement résolue.

| Identifiants existants | Décision et facette | Lots |
|---|---|---|
| `injection-directe`, `injection-de-prompt`, `jailbreak`, `detournement-de-contexte`, `jailbreak-multilingue` | Socle : limiter les conséquences par droits/actions ; les classifieurs d'injection ne sont pas une frontière absolue | T04, T06, T10, T14 |
| `injection-persistante`, `memoire-empoisonnee`, `manipulation-base-de-connaissances` | Socle pour mémoire/instructions locales : intégrité, provenance, écritures ; option séparée pour connaissances distantes | T03, T08, T14 |
| `extraction-prompt-systeme` | Socle : aucun secret dans les instructions ; les considérer comme lisibles par l'agent, protection ciblée des valeurs | T03, T07 |
| `obfuscation` | Socle : budgets de décodage et normalisation, formes non reconnues explicites ; pas de décodeur illimité | T03, T04, T14 |
| `injection-multimodale` | Socle sur actions possibles après lecture ; option sur inspection multimodale au relais, sans prétendre éliminer l'injection | T04, T07 |
| `autonomie-excessive`, `injection-appel-outil` | Socle : schémas et autorisations avant action | T01, T02, T04 |
| `depute-confus`, `identite-empruntee` | Socle : mandat, principal d'origine et droits effectifs ; compte humain du fournisseur distinct de l'identité d'exécution | T05, T06, T10 |
| `escalade-privileges-agent` | Socle renforcé : droits OS et outils gérés ; limite contre un administrateur de la machine | T04, T10 |
| `transactions-non-autorisees` | Socle : approbation spécifique et plafonds sur outils raccordés | T06, T07 |
| `boucle-agent` | Socle : budgets de session et de ressources ; arrêt effectif seulement dans un environnement contrôlé | T04, T10 |
| `injection-inter-agents`, `delegation-en-cascade` | Socle : contexte non fiable, permissions non amplifiables, parent/session ; agents hébergés hors périmètre exclus | T02, T04, T10 |
| `outil-piege` | Socle : registre MCP et empreintes, refus des changements non validés | T07 |
| `empoisonnement-rag`, `empoisonnement-vectoriel`, `inversion-embeddings`, `acces-rag`, `fuite-inter-clients-rag` | Option RAG, contrôles à l'ingestion/recherche/stockage ; extension seule insuffisante. Le raccordement MCP ne résout pas les ACL du RAG | Hors V1, intégration backend dédiée |
| `empoisonnement`, `empoisonnement-fine-tuning`, `modele-piege` | Externe pour modèle distant ; option de qualification pour équipes ML. Ne pas confondre backdoor comportementale et fichier exécutable | Hors V1 |
| `alteration-source-modele`, `modele-serialise-malveillant`, `depot-de-modeles-compromis`, `format-de-modele-dangereux` | Option ML : provenance et scan des artefacts locaux dans un environnement isolé | Après T11 |
| `vol-de-modele`, `extraction-par-api`, `inversion-de-modele`, `inference-appartenance` | Externe : protection du modèle ou du service d'inférence. Une règle fichiers peut protéger un poids local sans résoudre ces attaques | Hors V1 |
| `exemples-adverses`, `attaque-adverse-physique`, `patchs-adverses`, `attaques-par-transfert` | Externe : robustesse du modèle/capteur ; limiter les actions reste utile, mais ne constitue pas une défense de perception | Hors produit généraliste |
| `sorties-non-maitrisees`, `xss-contenu-genere` | Socle sur nos webviews/pages : données non fiables, CSP/encodage ; SAST du code généré seulement comme contrôle complémentaire | T09, T11 |
| `code-vulnerable` | Socle d'intégration qualité : verdicts SAST/SCA et gate serveur, jamais certification de sûreté du code | T11 |
| `injection-sql-via-llm` | Socle pour outils DB supervisés : permissions/requêtes restreintes ; vulnérabilités dans le code généré via SAST/revue | T06, T07, T11 |
| `injection-de-commande` | Socle : validation structurée et isolation, forme inconnue non autorisée automatiquement | T04, T10 |
| `ssrf-via-agent` | Socle renforcé : destinations contrôlées, redirections et réseau privé ; pas seulement une regex d'URL | T07, T10 |
| `traversee-de-chemin` | Socle : chemins et frontières filesystem, cas Windows/Unix et courses | T03, T10 |
| `fuite-de-donnees` | Socle pour ressources classifiées ; option PII localement mesurée, couverture partielle | T03, T07 |
| `fuite-dans-les-journaux` | Socle : métadonnées minimales, redaction avant observabilité, diagnostics inspectés | T07, T08, T14 |
| `fuite-de-secrets`, `vol-identifiants-cloud`, `vol-cle-api-ia` | Socle : réutiliser Secret Guard, réduire accès aux credentials ; rotation via outils du client | T03, T05, T07 |
| `memorisation-entrainement`, `inference-attributs-sensibles` | Externe : modèle, contrat fournisseur et minimisation ; aucune promesse d'effacement d'un modèle via l'extension | Hors V1 |
| `dependances-compromises`, `typosquatting` | Socle qualité/supply chain : registre, lockfile, scan et build isolé | T10, T11 |
| `framework-compromis` | Option ML pour framework d'entraînement ; chaîne de distribution xSOM traitée séparément par T13 | Après T11 |
| `serveur-inference-compromis`, `notebook-compromis` | Externe ou option pour infrastructure gérée par le client ; pas de contrôle automatique par extension | Hors V1 |
| `evasion-de-conteneur` | Socle de durcissement du profil renforcé ; mécanismes maintenus, patchs et tests, sans garantie contre toute faille noyau | T10 |
| `deni-de-service-modele`, `deni-de-portefeuille`, `complexite-algorithmique` | Socle : limites des flux observés, budgets et alertes ; coûts globaux selon données fournisseur disponibles | T04, T07, T13, T14 |
| `epuisement-gpu` | Externe pour GPU fournisseur ; quotas si environnement client spécialisé | Hors V1 |
| `hallucinations`, `fausses-citations` | Socle : réduire l'effet d'une décision erronée et demander revue ; exactitude sémantique/citations non garantie | T06, T11 |
| `phishing-augmente`, `usurpation-deepfake`, `fraude-voix-clonee` | Externe : messagerie/IAM ; nos approbations ne reposent pas sur une simple assertion de l'agent ou un message vocal | T06 pour la facette approbation |
| `malware-genere`, `decouverte-vulnerabilites` | Externe : EDR/IDS et gestion des vulnérabilités ; environnement d'exécution borné utile mais pas un antivirus | T10 pour confinement |
| `shadow-ai` | Socle : inventaire des assistants visibles et politiques ; contrôle complet du poste exige administration/réseau | T08, T10 |
| `provenance-modele-inconnue` | Socle : inventorier fournisseur/modèle déclaré, préciser s'il est observé par relais ; pas d'attestation des poids SaaS | T08, T12 |
| `red-teaming-insuffisant`, `derive-de-modele` | Socle : régression de nos contrôles lors des mises à jour hôte/modèle ; évaluation du modèle entier hors périmètre | T14 |
| `actions-non-tracables` | Socle : audit avec source et limites de collecte explicites, export et vérification | T08, T12 |

## Choix d'outillage proposés

Les noms viennent du brainstorming fourni. Aucun outil de cette liste n'est considéré comme intégré ou qualifié par cette annexe. Terra doit vérifier documentation primaire, licence exacte de chaque moteur/règle, maintenance et déploiement avant de l'adopter.

| Besoin | Candidats à évaluer | Arbitrage proposé |
|---|---|---|
| Secrets en interaction | Core Secret Guard existant | Le conserver ; Gitleaks/TruffleHog pour contrôles dépôt/CI complémentaires, sans vérification réseau de secrets réels |
| Policy | Moteur xSOM, OPA cité dans le catalogue | Réutiliser xSOM ; OPA seulement si un client exige un format/interfaçage précis |
| SAST | Semgrep, Bandit | Un moteur principal adapté aux langages pilotes ; exécution asynchrone/CI, jamais à chaque frappe |
| SCA / inventaire | osv-scanner, Trivy, Syft, Grype, CycloneDX | Retenir une chaîne minimale, éviter les scanners redondants ; distinguer génération d'inventaire et analyse |
| MCP | Registre/empreintes xSOM, mcp-scan | Exploiter l'existant ; scanner externe optionnel après comparaison de couverture |
| PII | Presidio | Option pour demande démontrée et corpus français mesuré ; aucune dépendance lourde dans le core secrets |
| Évaluation adverse | Promptfoo, garak, PyRIT, Giskard | Un harnais de campagne complémentaire au déterminisme existant ; dataset synthétique et budget maîtrisé |
| Artefacts de modèles | ModelScan, Fickling | Option équipes ML ; analyser sans charger/exécuter l'artefact sur le poste |
| Isolation | Primitives OS, AppArmor/SELinux/seccomp, gVisor/Kata | Sélection selon surface et exploitation ; aucun empilement systématique de tous les mécanismes |
| Provenance / audit externe | Sigstore/cosign, Rekor, OpenTelemetry | Qualifications distinctes ; ne pas publier de données confidentielles dans un registre public |

Pour chaque candidat retenu : raison du choix, fonction exacte, limites, version et licence, usage réseau, données sortantes, coût CPU/latence, mise à jour, scénario prouvé et alternative en cas d'indisponibilité. En faire un résultat T11, pas une liste de logos sur le site.

## Qualité de la source générée

La fiche `modele-piege` n'a actuellement ni titre ni parade extraite, alors que la source TypeScript contient des textes. Le générateur suppose une disposition multilignes qui ne correspond pas à toutes les entrées. Certains outils localisés sont également extraits en français et en anglais. Prévoir la correction du générateur en T12, avec test d'exhaustivité des 77 identifiants actuels et validation des champs ; ne pas éditer le Markdown généré manuellement.
