# Menaces IA - matière de brainstorming backend

> Document interne généré depuis `frontend/lib/threat-glossary.ts`. Il recense les parades de référence et les outils libres retirés de la table publique. Ce sont des pistes de conception, pas des capacités déjà livrées par AI Guard.

## Comment l'utiliser

Pour chaque menace, confronter la parade proposée au périmètre produit : contrôle déterministe, journal d'audit, validation humaine, isolation de tenant, ou intégration d'un outil tiers. Ne pas présenter un outil listé ici comme intégré sans preuve d'implémentation.

## Injection de prompt directe `injection-directe`

- Catégorie : prompt
- Parade de référence : Frontières d’instructions strictes, filtrage des entrées, moindre privilège, validation des sorties, red teaming.
- Outils libres à évaluer : NeMo Guardrails, garak, Promptfoo, PyRIT, Giskard

## Injection de prompt indirecte `injection-de-prompt`

- Catégorie : prompt
- Parade de référence : Traiter les données récupérées comme non fiables ; séparer instructions et contenu ; permissions d’outils ; confirmation.
- Outils libres à évaluer : NeMo Guardrails, Promptfoo, garak

## Injection de prompt persistante `injection-persistante`

- Catégorie : prompt
- Parade de référence : Provenance, assainissement à l’ingestion, zones de confiance, ACL sur la recherche.
- Outils libres à évaluer : Promptfoo, Filtres RAG sur mesure, Custom RAG filters

## Jailbreak `jailbreak`

- Catégorie : prompt
- Parade de référence : Alignement de sécurité, classifieurs, garde-fous à l’exécution et tests continus.
- Outils libres à évaluer : garak, PyRIT, Promptfoo, DeepTeam

## Extraction du prompt système `extraction-prompt-systeme`

- Catégorie : prompt
- Parade de référence : Ne jamais placer de vrai secret dans un prompt ; isoler les secrets ; filtrer les sorties.
- Outils libres à évaluer : garak, Promptfoo, PyRIT

## Détournement de contexte `detournement-de-contexte`

- Catégorie : prompt
- Parade de référence : Hiérarchie des instructions et segmentation du contexte.
- Outils libres à évaluer : Guardrails, Moteur de policy maison, Custom policy engine

## Attaques par encodage et obfuscation `obfuscation`

- Catégorie : prompt
- Parade de référence : Canoniser et normaliser les entrées ; décoder avant d’analyser.
- Outils libres à évaluer : PyRIT, Promptfoo, Bibliothèques de sécurité Unicode, Unicode security libraries

## Jailbreak multilingue `jailbreak-multilingue`

- Catégorie : prompt
- Parade de référence : Classifieurs de sécurité multilingues et tests adverses.
- Outils libres à évaluer : garak, Promptfoo

## Injection de prompt multimodale `injection-multimodale`

- Catégorie : prompt
- Parade de référence : Séparer perception et exécution ; OCR et inspection du contenu ; pas d’usage autonome des outils.
- Outils libres à évaluer : Outils de recherche, Research tooling, Red teaming multimodal, Multimodal red teaming

## Autonomie excessive `autonomie-excessive`

- Catégorie : agents
- Parade de référence : Moindre privilège, portées par outil, approbation humaine, bac à sable.
- Outils libres à évaluer : Open Policy Agent (OPA)

## Injection d’appels d’outils `injection-appel-outil`

- Catégorie : agents
- Parade de référence : Schémas explicites, validation, contrôle de policy autour de chaque appel.
- Outils libres à évaluer : OPA, Guardrails

## Député confus `depute-confus`

- Catégorie : agents
- Parade de référence : Lier l’autorisation à l’utilisateur, pas au modèle ; jetons de capacité.
- Outils libres à évaluer : OPA, Portées OAuth, OAuth scopes

## Élévation de privilèges d’un agent `escalade-privileges-agent`

- Catégorie : agents
- Parade de référence : RBAC ou ABAC, bac à sable, comptes de service distincts.
- Outils libres à évaluer : OPA, SELinux, AppArmor

## Transactions non autorisées `transactions-non-autorisees`

- Catégorie : agents
- Parade de référence : Approbation humaine des opérations lourdes de conséquences ; plafonds de transaction.
- Outils libres à évaluer : Moteurs de workflow, Workflow engines, OPA

## Boucle d’agent incontrôlée `boucle-agent`

- Catégorie : agents
- Parade de référence : Nombre maximal d’étapes, budgets d’exécution, délais, coupe-circuits.
- Outils libres à évaluer : Contrôles applicatifs, Application controls

## Injection entre agents `injection-inter-agents`

- Catégorie : agents
- Parade de référence : Authentifier les messages entre agents ; protocoles structurés ; séparation des niveaux de confiance.
- Outils libres à évaluer : OPA, Validation sur mesure, Custom validation

## Mémoire d’agent empoisonnée `memoire-empoisonnee`

- Catégorie : agents
- Parade de référence : Provenance, autorisation d’écriture, expiration, journaux immuables.
- Outils libres à évaluer : ACL de base vectorielle, Vector DB ACLs, Contrôles sur mesure, Custom controls

## Outil piégé (tool poisoning, rug pull) `outil-piege`

- Catégorie : agents
- Parade de référence : Épingler et relire les définitions d’outils ; détecter leurs changements ; liste blanche de serveurs.
- Outils libres à évaluer : mcp-scan, Épinglage des outils, Tool pinning

## Agent sous identité humaine `identite-empruntee`

- Catégorie : agents
- Parade de référence : Identités propres aux agents, accès de courte durée, journaux attribués.
- Outils libres à évaluer : SPIFFE/SPIRE, Comptes de service dédiés, Dedicated service accounts

## Délégation en cascade entre agents `delegation-en-cascade`

- Catégorie : agents
- Parade de référence : Propager le mandat d’origine et le vérifier à chaque étape.
- Outils libres à évaluer : OPA, Échange de jetons OAuth, OAuth token exchange

## Empoisonnement du RAG `empoisonnement-rag`

- Catégorie : rag
- Parade de référence : Sources de confiance en liste blanche, signature des documents, provenance, détection d’anomalies.
- Outils libres à évaluer : Promptfoo, Giskard

## Empoisonnement de la base vectorielle `empoisonnement-vectoriel`

- Catégorie : rag
- Parade de référence : Authentification, validation des documents, contrôles d’intégrité.
- Outils libres à évaluer : Qdrant (ACL), Milvus (ACL)

## Inversion d’embeddings `inversion-embeddings`

- Catégorie : rag
- Parade de référence : Limiter les embeddings sensibles ; chiffrement et contrôle d’accès.
- Outils libres à évaluer : Chiffrement et contrôle d’accès standard, Standard crypto and access control

## Accès indu aux documents du RAG `acces-rag`

- Catégorie : rag
- Parade de référence : Autorisation avant la recherche ; ACL par document.
- Outils libres à évaluer : OPA, ACL de base vectorielle, Vector-store ACLs

## Fuite entre clients dans le RAG `fuite-inter-clients-rag`

- Catégorie : rag
- Parade de référence : Cloisonnement strict des espaces de noms et authentification liée au client.
- Outils libres à évaluer : ACL de base de données et vectorielle, Database and vector DB ACLs

## Empoisonnement des données d’entraînement `empoisonnement`

- Catégorie : model
- Parade de référence : Provenance des jeux de données, assainissement, détection d’anomalies, écriture restreinte.
- Outils libres à évaluer : Frameworks de validation de données, Data validation frameworks, ART

## Empoisonnement du fine-tuning `empoisonnement-fine-tuning`

- Catégorie : model
- Parade de référence : Jeux de données de confiance, tests différentiels, évaluation du modèle.
- Outils libres à évaluer : garak, Giskard, ART

##  `modele-piege`

- Catégorie : model
- Parade de référence : À qualifier
- Outils libres à évaluer : ModelScan, Fickling, garak

## Altération du modèle avant déploiement `alteration-source-modele`

- Catégorie : model
- Parade de référence : Empreintes, signatures, chaînes de build reproductibles.
- Outils libres à évaluer : Sigstore/cosign, Signature Git, Git signing

## Modèle sérialisé malveillant `modele-serialise-malveillant`

- Catégorie : model
- Parade de référence : Préférer des formats sûrs comme safetensors ; bac à sable ; analyser les modèles.
- Outils libres à évaluer : ModelScan, Fickling

## Vol ou exfiltration de poids `vol-de-modele`

- Catégorie : model
- Parade de référence : IAM, chiffrement, isolement réseau, journalisation.
- Outils libres à évaluer : Pile IAM et sécurité open source, Open-source IAM and security stack

## Extraction de modèle par l’API `extraction-par-api`

- Catégorie : model
- Parade de référence : Limites de débit, contrôle des sorties, détection, recherche sur le tatouage.
- Outils libres à évaluer : Passerelles d’API, API gateways, Limitation de débit, Rate limiting

## Inversion de modèle `inversion-de-modele`

- Catégorie : model
- Parade de référence : Confidentialité différentielle ; sorties moins détaillées, sans scores de confiance.
- Outils libres à évaluer : Opacus, TensorFlow Privacy

## Inférence d’appartenance `inference-appartenance`

- Catégorie : model
- Parade de référence : Confidentialité différentielle, régularisation, sorties limitées.
- Outils libres à évaluer : ART, Opacus

## Exemples adverses (évasion) `exemples-adverses`

- Catégorie : adversarial
- Parade de référence : Entraînement adverse, prétraitement robuste, ensembles de modèles.
- Outils libres à évaluer : IBM Adversarial Robustness Toolbox (ART)

## Attaque adverse physique `attaque-adverse-physique`

- Catégorie : adversarial
- Parade de référence : Fusion de capteurs, entraînement adverse, contrôles de robustesse.
- Outils libres à évaluer : ART

## Patchs adverses `patchs-adverses`

- Catégorie : adversarial
- Parade de référence : Détection et entraînement robuste.
- Outils libres à évaluer : ART

## Attaques par transfert `attaques-par-transfert`

- Catégorie : adversarial
- Parade de référence : Évaluation adverse et ingénierie de la robustesse.
- Outils libres à évaluer : ART

## Traitement non sécurisé des sorties `sorties-non-maitrisees`

- Catégorie : output
- Parade de référence : Traiter la sortie du modèle comme une entrée non fiable ; paramétrer ; encoder et valider.
- Outils libres à évaluer : Semgrep, Bibliothèques OWASP, OWASP libraries

## Code généré vulnérable `code-vulnerable`

- Catégorie : output
- Parade de référence : Relecture, analyse statique (SAST) en CI, maintien des contrôles de sécurité du projet.
- Outils libres à évaluer : Semgrep, Bandit

## Injection SQL via le LLM `injection-sql-via-llm`

- Catégorie : output
- Parade de référence : Requêtes paramétrées et interface de requête restreinte.
- Outils libres à évaluer : SQLAlchemy, Droits de base de données, Database permissions

## Injection de commande `injection-de-commande`

- Catégorie : output
- Parade de référence : Éviter le shell ; API en liste blanche ; bac à sable.
- Outils libres à évaluer : seccomp

## XSS par contenu généré `xss-contenu-genere`

- Catégorie : output
- Parade de référence : Encodage et assainissement des sorties selon leur contexte.
- Outils libres à évaluer : DOMPurify, OWASP Java Encoder

## SSRF par un agent `ssrf-via-agent`

- Catégorie : output
- Parade de référence : Liste blanche de sortie, isolement réseau, validation des URL.
- Outils libres à évaluer : Pare-feu et proxys, Firewalls and proxies, OPA

## Traversée de répertoire `traversee-de-chemin`

- Catégorie : output
- Parade de référence : Canonisation des chemins et répertoires cloisonnés.
- Outils libres à évaluer : Codage sécurisé standard, Standard secure coding

## Divulgation d’informations sensibles `fuite-de-donnees`

- Catégorie : privacy
- Parade de référence : Minimisation des données, DLP, filtrage, contrôle d’accès.
- Outils libres à évaluer : Microsoft Presidio

## Prompts et secrets dans les journaux `fuite-dans-les-journaux`

- Catégorie : privacy
- Parade de référence : Masquage, journalisation restreinte, chiffrement.
- Outils libres à évaluer : Presidio, Filtres OpenTelemetry, OpenTelemetry filters

## Fuite de secrets `fuite-de-secrets`

- Catégorie : privacy
- Parade de référence : Détection des secrets avant l’envoi.
- Outils libres à évaluer : Gitleaks, TruffleHog

## Mémorisation des données d’entraînement `memorisation-entrainement`

- Catégorie : privacy
- Parade de référence : Dédoublonnage, entraînement confidentiel, confidentialité différentielle, filtres de sortie.
- Outils libres à évaluer : Opacus, Presidio

## Inférence d’attributs sensibles `inference-attributs-sensibles`

- Catégorie : privacy
- Parade de référence : Minimisation des données, sorties restreintes, tests de confidentialité.
- Outils libres à évaluer : ART, Outils de confidentialité, Privacy tooling

## Dépôt de modèles compromis `depot-de-modeles-compromis`

- Catégorie : supply
- Parade de référence : Vérifier l’éditeur, l’empreinte et la signature ; analyser l’artefact.
- Outils libres à évaluer : ModelScan, Fickling, Sigstore

## Dépendances compromises `dependances-compromises`

- Catégorie : supply
- Parade de référence : Fichiers de verrouillage, SBOM, signature, analyse.
- Outils libres à évaluer : Syft, Grype, Trivy, osv-scanner

## Typosquatting et confusion de dépendances `typosquatting`

- Catégorie : supply
- Parade de référence : Registre interne, contrôle des espaces de noms, fichiers de verrouillage.
- Outils libres à évaluer : Contrôles pip et npm, pip and npm controls, Analyseurs de dépendances, Dependency scanners

## Framework d’entraînement compromis `framework-compromis`

- Catégorie : supply
- Parade de référence : Builds de confiance, empreintes, SBOM, artefacts signés.
- Outils libres à évaluer : Sigstore, Outillage SLSA, SLSA tooling

## Format de modèle dangereux `format-de-modele-dangereux`

- Catégorie : supply
- Parade de référence : Safetensors ou une autre représentation non exécutable.
- Outils libres à évaluer : ModelScan, Fickling

## Vol d’identifiants GPU ou cloud `vol-identifiants-cloud`

- Catégorie : infra
- Parade de référence : Identité de charge de travail, identifiants de courte durée, coffre à secrets.
- Outils libres à évaluer : OpenBao / Vault, Outillage des secrets Kubernetes, Kubernetes secrets tooling

## Vol de clé d’API IA `vol-cle-api-ia`

- Catégorie : infra
- Parade de référence : Gestion des secrets, rotation des clés, portées limitées.
- Outils libres à évaluer : OpenBao / Vault, Gitleaks, TruffleHog

## Serveur d’inférence compromis `serveur-inference-compromis`

- Catégorie : infra
- Parade de référence : Gestion des correctifs, isolement des conteneurs, authentification.
- Outils libres à évaluer : Trivy, Falco, Kubernetes

## Évasion de conteneur `evasion-de-conteneur`

- Catégorie : infra
- Parade de référence : seccomp, espaces de noms, isolement par VM.
- Outils libres à évaluer : Docker, Kata Containers, gVisor

## Notebook compromis `notebook-compromis`

- Catégorie : infra
- Parade de référence : Authentification, isolement réseau, bac à sable par utilisateur.
- Outils libres à évaluer : JupyterHub

## Déni de service du modèle `deni-de-service-modele`

- Catégorie : availability
- Parade de référence : Quotas, limites de débit, plafonds de taille et de jetons.
- Outils libres à évaluer : NGINX, Envoy, Kong

## Déni de portefeuille `deni-de-portefeuille`

- Catégorie : availability
- Parade de référence : Budgets et limites par utilisateur ; alertes de dépense.
- Outils libres à évaluer : Passerelles d’API, API gateways, Suivi de facturation, Billing monitors

## Attaques par complexité algorithmique `complexite-algorithmique`

- Catégorie : availability
- Parade de référence : Plafonds de jetons et de taille d’entrée, délais.
- Outils libres à évaluer : Contrôles de passerelle standard, Standard gateway controls

## Épuisement des ressources GPU `epuisement-gpu`

- Catégorie : availability
- Parade de référence : Quotas Kubernetes et limites d’ordonnancement.
- Outils libres à évaluer : Kubernetes

## Hallucinations exploitées `hallucinations`

- Catégorie : integrity
- Parade de référence : Ancrage dans des sources, recherche, vérification, approbation avant d’agir.
- Outils libres à évaluer : Giskard, Frameworks d’évaluation, Eval frameworks

## Fausses citations `fausses-citations`

- Catégorie : integrity
- Parade de référence : Résoudre et vérifier les sources citées par programme.
- Outils libres à évaluer : Validateurs sur mesure, Custom validators

## Manipulation de la base de connaissances `manipulation-base-de-connaissances`

- Catégorie : integrity
- Parade de référence : Données signées, provenance, pondération des sources.
- Outils libres à évaluer : Sigstore, Contrôles sur mesure, Custom controls

## Phishing augmenté par l’IA `phishing-augmente`

- Catégorie : human
- Parade de référence : Sécurité de la messagerie, DMARC, vérification des utilisateurs, détection d’anomalies.
- Outils libres à évaluer : SpamAssassin

## Usurpation par deepfake `usurpation-deepfake`

- Catégorie : human
- Parade de référence : Authentification hors bande, détection du vivant, provenance cryptographique.
- Outils libres à évaluer : C2PA

## Fraude à la voix clonée `fraude-voix-clonee`

- Catégorie : human
- Parade de référence : Ne jamais accepter une voix seule comme authentification.
- Outils libres à évaluer : MFA standard, Standard MFA

## Malware généré par IA `malware-genere`

- Catégorie : human
- Parade de référence : Détection endpoint et réseau existante, surveillance des abus.
- Outils libres à évaluer : YARA, Sigma, Suricata, ClamAV

## Découverte automatisée de vulnérabilités `decouverte-vulnerabilites`

- Catégorie : human
- Parade de référence : Gestion de la surface d’attaque, IDS, correctifs.
- Outils libres à évaluer : Nuclei, Wazuh, Suricata

## Shadow AI `shadow-ai`

- Catégorie : governance
- Parade de référence : Inventaire des applications, contrôles sur les postes, services approuvés.
- Outils libres à évaluer : Surveillance DNS et proxy, DNS and proxy monitoring, DLP

## Provenance de modèle inconnue `provenance-modele-inconnue`

- Catégorie : governance
- Parade de référence : Inventaire IA et ML, provenance, SBOM et ML-BOM.
- Outils libres à évaluer : CycloneDX

## Red teaming IA insuffisant `red-teaming-insuffisant`

- Catégorie : governance
- Parade de référence : Évaluation adverse continue dans la CI/CD.
- Outils libres à évaluer : garak, PyRIT, Promptfoo, Giskard

## Dérive ou régression de sécurité du modèle `derive-de-modele`

- Catégorie : governance
- Parade de référence : Suite de non-régression de sécurité avant chaque mise en production.
- Outils libres à évaluer : Promptfoo, garak, Giskard

## Actions d’agent non traçables `actions-non-tracables`

- Catégorie : governance
- Parade de référence : Journaux en ajout seul et infalsifiables, décisions signées, preuves exportables.
- Outils libres à évaluer : Sigstore Rekor, OpenTelemetry
