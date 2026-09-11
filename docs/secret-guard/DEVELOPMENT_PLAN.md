# Secret Guard — Plan de développement

**Statut :** roadmap V0 → enterprise ; seuls les éléments de l’état livré ci-dessous sont implémentés

**Date :** 11 septembre 2026

**Architecture :** [ARCHITECTURE.md](./ARCHITECTURE.md)

**Threat model :** [THREAT_MODEL.md](./THREAT_MODEL.md)

Après la section « État réellement livré », les listes de composants,
livrables, tests et critères décrivent la **cible** de chaque phase, sauf mention
explicite contraire. Elles ne valent pas inventaire de capacités présentes.

## 0. État réellement livré

Le dépôt contient un **prototype V0.2 multi-hôte**, pas encore un contrôle de
sécurité certifié :

- core TypeScript synchrone, local, sans dépendance runtime, avec limite de 1 MiB
  UTF-8, scores ALLOW/WARN/BLOCK, offsets, union/redaction et rescan fail-closed ;
- CLI de scan stdin/fichier et processus de hook ; `scan` utilise les codes
  0/1/**2** pour ALLOW/WARN/BLOCK ; `hook` sort 0 avec JSON pour ALLOW et **2**
  avec stdout vide pour WARN/BLOCK/entrée invalide ;
- participant `@secretguard`, commandes de scan et installateur transactionnel
  des hooks utilisateur VS Code/Copilot, Claude Code, Codex et Windsurf ;
- statut cadenas « actif », « partiel », « dégradé » ou « désactivé », fondé sur
  les quatre configurations, l’intégrité du runner et deux protocoles de canari ;
- tests unitaires et hostiles, contrats subprocess, smoke Extension Host,
  inspection structurelle du VSIX, évaluation synthétique de 1 150 positifs et
  50 000 négatifs, fuzz smoke déterministe de 100 000 entrées, dogfood et
  benchmarks bornés.

Ne sont pas livrés : preuve d’interception hôte de bout en bout, déploiement
système/MDM, gestion complète de Workspace Trust/policies, topologie Remote,
corpus public représentatif
annoté, fuzz coverage-guided ou exhaustif, SBOM/checksums de release/signature,
règles gérées, audit ou télémétrie.

Les canaris actuels exécutent directement le runner local avec les enveloppes
`UserPromptSubmit` et `pre_user_prompt`. Ils ne prouvent pas que chaque hôte a
chargé ou invoqué son hook. Une policy administrateur, la version de l’hôte ou un
Extension Host distant peuvent préempter la configuration utilisateur.

## 1. Résultat visé

Le produit visé n’est pas un « antivirus universel de tous les assistants ». La
roadmap cherche une chaîne locale, mesurée et testable qui :

1. contrôle le routage du prompt saisi dans l’interface Secret Guard et bloque
   localement les verdicts non admissibles ;
2. étend ensuite la protection aux hôtes dont le contrat UserPromptSubmit aura été testé ;
3. indique précisément quelles surfaces sont couvertes ;
4. bloque avant egress sur détection ou panne locale ;
5. ne journalise jamais le contenu ni la valeur d’un secret ;
6. peut évoluer vers un provider/gateway géré.

Le prototype actuel couvre une partie des Phases 0 à 3. La validation de Phase 3
sur corpus représentatif, les pièces jointes, Claude/Codex, le ML, la distribution
générale et l’enterprise restent des lots séparés.

## 2. Principes d’exécution

- TypeScript et **Node.js 22.13+** pour le workspace, le CLI et les validations.
- Un seul moteur de décision local, indépendant de VS Code.
- Aucun réseau dans le core.
- Aucune collecte de secrets utilisateurs, même pour améliorer les règles.
- Entrée supérieure à 1 MiB : BLOCK, jamais scan partiel.
- WARN brut autorisé seulement après confirmation explicite par requête dans l’UI
  possédée ; le hook le bloque par défaut. L’option globale `warn=allow` existe
  techniquement mais place la surface hors du mode protégé.
- Les scores sont des scores d’évidence, pas des probabilités.
- Aucun statut PROTECTED n’est livré. Une future attestation nécessitera une preuve
  de bout en bout que l’hôte a intercepté ; un canari CLI local seul est insuffisant.
- Les fixtures positives sont synthétiques ou issues d’exemples publics explicitement sûrs.
- Toute dépendance et toute règle importée possèdent une provenance et une licence.

## 3. Organisation cible

```text
secret-guard/
├── package.json
├── packages/
│   ├── core/
│   │   ├── src/
│   │   └── package.json
│   ├── cli/
│   │   ├── src/
│   │   └── package.json
│   └── vscode/
│       ├── src/
│       └── package.json
├── tests/
│   ├── core/
│   ├── cli/
│   ├── vscode/
│   ├── fixtures/
│   └── adversarial/
├── benchmarks/
│   ├── corpus/
│   └── results/
├── rules/
│   ├── ruleset.json
│   ├── schema.json
│   └── THIRD_PARTY_NOTICES.md
└── scripts/
    ├── benchmark
    ├── build-vsix
    └── verify-artifacts
```

Le ruleset peut rester compilé dans core au V0. Le dossier rules devient nécessaire avant une mise à jour indépendante ou des custom patterns.

## 4. Definition of done globale

Une phase n’est pas terminée parce que le code compile. Elle est terminée quand :

- ses décisions sont inscrites dans un ADR ;
- les tests unitaires, d’intégration, adversarial et confidentialité pertinents passent ;
- les résultats de benchmark sont versionnés avec machine, OS, Node, corpus et commit ;
- les limites produit sont reflétées dans l’UX et la documentation ;
- les artefacts reproductibles et leur SBOM sont disponibles ;
- aucune valeur de secret synthétique n’apparaît dans les sorties observables ;
- les régressions critiques bloquent la CI.

## 5. Phase 0 — Research / feasibility

**État : partiel.** L’architecture, le threat model et un corpus synthétique
généré existent ; la matrice multi-hôtes, le corpus représentatif, les benchmarks
OSS et les canaris hôte ne sont pas livrés.

### Objectif

Prouver les frontières d’interception, choisir le moteur et transformer les promesses produit en contrats testables avant d’étendre l’implémentation.

### Composants

- matrice VS Code pour le V0 ; Claude Code, Codex, provider et gateway sont des
  études futures ;
- spikes UserPromptSubmit sur macOS, Windows et Linux ;
- benchmark des moteurs OSS ;
- corpus initial positif/négatif/adversarial ;
- threat model et registre de risques ;
- ADR du core TypeScript et du CLI stdin/stdout ;
- décision de licence du produit et politique de réutilisation.

### Décisions techniques

- abandon de l’overlay DOM ;
- aucune interception universelle revendiquée ;
- core TypeScript synchrone, sans I/O ;
- hook command local, pas hook MCP comme contrôle principal ;
- pas de ML ;
- seuil dur de 1 MiB UTF-8 ;
- catalogue de regex V0 statique et borné ;
- spike RE2-Wasm avant toute regex personnalisée.

### Livrables

- ARCHITECTURE.md et THREAT_MODEL.md approuvés ;
- matrice de compatibilité avec versions exactes ;
- harness de contrat par hôte ;
- rapport benchmark OSS ;
- inventaire SPDX et THIRD_PARTY_NOTICES initial ;
- ADR-001 Core TypeScript, ADR-002 Interception, ADR-003 No-ML-V0 ;
- backlog de risques avec propriétaire et échéance.

### Tests

- hook VS Code : prompt sain, secret synthétique, réponse JSON, code 2 de la
  commande scan, timeout et preuve d’invocation par l’hôte ;
- Claude et Codex : contrats propres à ajouter seulement lorsqu’ils entrent dans
  une version future ;
- Remote SSH/WSL/Container : preuve du lieu d’exécution ;
- prototype du participant `@secretguard` : aucune requête du faux provider avant
  un verdict admissible ;
- performance minimale de 25/100/250 règles sur 16 KiB et 1 MiB.

### Critères de réussite

- chaque cellule de la matrice est classée Strong, Conditional ou Unsupported ;
- aucun chemin Unsupported n’est affiché comme protégé ;
- preuve de blocage de bout en bout dans VS Code, distincte des canaris CLI ;
- choix du moteur documenté avec données, licence et plan de fallback ;
- aucun blocker juridique connu pour les règles effectivement portées ;
- budget V0 approuvé.

### Principales difficultés

- APIs Preview qui évoluent ;
- différences entre VS Code local et Extension Host distant ;
- absence de middleware universel ;
- confusion entre prompt tapé et contexte réellement envoyé ;
- conditions de licence des rulesets et jeux de test.

### Estimation

**5 à 8 jours-personnes**, soit environ une semaine calendaire avec un engineer plateforme et une revue sécurité.

## 6. Phase 1 — Secret detection engine

**État : prototype livré, évaluation partielle.** Le core, ses règles, un runner
synthétique de 50 000 négatifs et un fuzz smoke déterministe de 100 000 cas sont
présents. Ils ne remplacent pas un corpus représentatif annoté, une campagne
coverage-guided ou une validation statistique sur des prompts réels.

### Objectif

Livrer un moteur local déterministe qui détecte, explique et expurge les secrets
V0 sans exposer leur valeur et dans des budgets de latence mesurés.

### Composants

#### Core

- ScanInput, ScanResult, Finding, RiskLevel et Decision ;
- mesure UTF-8 et limite 1 MiB ;
- mapping offsets UTF-16/ligne/colonne ;
- vues originale, NFKC/zero-width/bidi filtrée, percent-decoded en UTF-8 strict,
  JSON Unicode et slash échappés, et jointure bornée ;
- décodage Base64 à un niveau, limité à 16 384 octets de sortie par opération,
  128 tentatives et 262 144 octets de sortie estimés et budgétés globalement
  entre candidats génériques, segments JWT et auth Docker ;
- jointure multiligne limitée à 128 fenêtres candidates de 16 384 caractères ;
- détection structurée ;
- parsing d’affectations et URL ;
- entropie Shannon par alphabet ;
- scoring/policy ;
- consolidation des plages ;
- union/redaction et rescan ; `redactAndRescan` rend `content:""` si le scan
  initial est incomplet ou si le verdict final n’est pas complet et ALLOW.

Le core plafonne les findings à 2 048. Il couvre un bloc PEM entier jusqu’au
footer correspondant dans l’entrée de 1 MiB, ou jusqu’à la fin si le footer
manque. Il ne possède pas de budget wall-clock distinct.

#### Règles prioritaires

- private keys PEM ;
- GitHub/GitLab ;
- OpenAI/Anthropic/OpenRouter ;
- AWS access-key ID isolé (WARN), affectations AWS sensibles et Azure AccountKey ;
  aucun détecteur GCP dédié n’est revendiqué ;
- Stripe, Slack, npm, SendGrid et familles à préfixe fort ;
- JWT ;
- database URLs ;
- password/secret/token dans .env, JSON, YAML, TOML, shell et code ;
- secret générique contextualisé et haute entropie.

#### Filtres

- UUID ;
- SHA et digests ;
- SRI ;
- formes hash/SRI rencontrées dans des lockfiles, sans parseur de lockfile ;
- public IDs connus ;
- placeholders exacts ;
- trois exemples publics exacts compilés ; aucune exemption par contexte fixture ;
- valeurs non quotées/non numériques considérées comme expressions pour une
  liste fermée de `languageId` de code, sans neutraliser les signatures fixes ;
- répétitions et faible diversité.

### Décisions techniques

- les signatures fournisseur fortes gagnent sur les filtres génériques ;
- un AWS Access Key ID isolé ou un identifiant public ne suffit pas pour un BLOCK critique ;
- l’entropie seule produit au plus MEDIUM ;
- une règle password capture seulement la valeur, pas toute l’affectation ;
- pas de validation active réseau ;
- pas de regex dynamique ;
- exceptions persistantes reportées ;
- le core retourne des offsets, jamais de snippets.

### Livrables

- package @xsom/secret-guard-core ;
- schéma du résultat et changelog ;
- catalogue V0 versionné ;
- suite de fixtures synthétiques ;
- générateur de mutations ;
- benchmark reproductible ;
- rapport de couverture par type ;
- documentation d’ajout/revue d’une règle.

### Tests

#### Unitaires

- un test positif et au moins cinq négatifs par règle ;
- bornes exactes, encodages et Unicode ;
- parsers d’affectation et URL ;
- entropie sur alphabets hex/Base64/alphanumérique ;
- scores, niveaux et actions ;
- fusion des findings et redaction.

#### Property-based

- redaction idempotente ;
- texte redacted sans finding bloquant ;
- offsets toujours dans les bornes ;
- ScanResult sérialisable et sans valeur ;
- ajout de texte bénin hors plage ne change pas le finding ;
- aucune exception non interceptée.

#### Fuzz / hostile

- patterns contre entrées répétitives ;
- zero-width à toutes les positions ;
- Base64 invalide, padding et expansion ;
- JSON/URL malformés ;
- plusieurs milliers de quasi-candidats ;
- seuil 1 MiB − 1, 1 MiB, 1 MiB + 1.

#### Confidentialité

- canari absent des logs, errors, stdout/stderr, snapshots et telemetry mock ;
- faux provider non appelé sur BLOCK ;
- aucun digest non salé.

#### Benchmark

- 1, 8, 16, 64, 256 KiB et 1 MiB ;
- prompt bénin, secret début/milieu/fin, quasi-candidats ;
- p50/p95/p99, RSS, CPU et cold/warm ;
- différentiel contre Gitleaks, Titus, detect-secrets et Secretlint hors runtime.

### Critères de réussite avant certification

Ces objectifs ne sont pas des résultats mesurés du prototype actuel :

- rappel ≥ 99 % sur les formats structurés explicitement supportés du corpus synthétique ;
- précision de BLOCK ≥ 99,5 %, objectif 99,9 % ;
- zéro faux BLOCK dans la suite négative obligatoire ;
- faux BLOCK ≤ 0,1 % des prompts du corpus bénin représentatif, objectif ≤ 0,01 % ;
- exactitude des plages ≥ 99,9 % ;
- 100 % des entrées > 1 MiB bloquées ;
- objectifs de latence définitifs à calibrer après un corpus représentatif ;
- zéro croissance superlinéaire observée sous la campagne fuzz définie ;
- couverture et branches fail-closed renforcées au-delà du gate prototype.

Les gates **réellement configurés** aujourd’hui sont : couverture core 90 %
lignes/statements/fonctions et **85 % branches** ; benchmark core chaud sur texte
sain à 16 KiB p95/p99 15/30 ms, 256 KiB 75/125 ms et 1 MiB 250/400 ms ; 16 KiB
en subprocess CLI, 20 lancements, p95 ≤ 350 ms. Trois entrées adversariales
ciblées doivent chacune finir en moins de 2 secondes. L’évaluation synthétique exige
rappel ≥ 99 %, précision BLOCK ≥ 99,5 %, faux BLOCK ≤ 0,1 %, rejet effectif du
hook par défaut ≤ 0,5 % et couverture complète du catalogue fixe. Le benchmark
ne couvre ni RSS/CPU, ni secret début/milieu/fin, ni extension/hôte de bout en
bout. Les taux du corpus généré ne sont pas extrapolables aux prompts réels.

### Principales difficultés

- équilibre précision/rappel pour password générique ;
- mapping exact après NFKC/décodage ;
- détection de tokens découpés sans exploser les faux positifs ;
- performances de centaines de règles ;
- JavaScript ne permet pas de zeroization forte des strings ;
- port de règles Go/RE2 vers JavaScript sans changer leur sémantique.

### Estimation

**20 à 30 jours-personnes**, dont 4–6 pour le corpus/ruleset, 8–12 pour le pipeline et 8–12 pour tests, fuzz et benchmark.

## 7. Phase 2 — VS Code MVP

**État : prototype partiel.** Le participant, les commandes, le bundle hook,
l’écriture du fichier utilisateur, le contrôle d’intégrité et les canaris locaux
existent. L’attestation hôte, le canari de bout en bout, le backup/merge, Remote
et les contrats multi-OS ne sont pas livrés.

### Objectif

Fournir une expérience VS Code installable qui contrôle son participant possédé et
peut configurer, à la demande, le hook VS Code Preview.

### Composants

#### Extension

- @secretguard, participant de chat ;
- commandes scanner sélection, presse-papiers et document ;
- éventuel Safe Prompt dédié, non livré, si le participant ne suffit pas ;
- présentation des findings en modal/Markdown, sans webview dédiée ;
- action Copier la version expurgée ;
- statut off/Preview/dégradé fondé sur configuration, intégrité et canari local ;
  une attestation de couverture effective reste future ;
- gestion des erreurs en français ;
- aucun contenu persistant.

#### CLI

- package @xsom/secret-guard-cli ;
- lecture bornée de stdin ;
- contrat de processus utilisé par le hook VS Code Preview : exit 0 et JSON
  `continue:true` sur ALLOW, exit 2 et stdout vide sur refus ; contrats Claude et
  Codex futurs et non certifiés ;
- mapping ALLOW/WARN/BLOCK ;
- sorties non sensibles ;
- codes d’erreur stables.

#### Hook manager

- fichier utilisateur dédié `~/.copilot/hooks/xsom-secret-guard.json` ;
- copie du bundle et écriture par renommage atomique ;
- commandes d’activation et de suppression du fichier dédié ;
- chemin de commande POSIX/Windows rendu dans la configuration.
- comparaison exacte du runner au bundle, canaris locaux sain/bloquant et refus
  d’écraser/supprimer une configuration étrangère.

Le merge d’un fichier préexistant, le backup/rollback, l’attestation des chemins,
Remote Extension Host et le canari de bout en bout restent à implémenter.

### Décisions techniques

- aucune modification DOM ;
- aucune interception de commandes privées ;
- l’utilisateur déclenche explicitement la lecture du presse-papiers ;
- WARN devient BLOCK par défaut sur le hook ; `warn=allow` est un mode affaibli et
  non protégé ;
- WARN brut dans `@secretguard` exige une confirmation explicite par requête ;
- la version redacted n’est envoyée qu’après un rescan complet ALLOW ; WARN,
  BLOCK, exception et scan incomplet sont refusés ;
- le statut « actif » atteste uniquement le runner et les configurations locales, jamais un
  état PROTECTED de l’hôte ;
- modification de configuration après déclenchement explicite de la commande ;
- chemins absolus vers le runtime et le runner copié, contrôlés par canari local,
  sans interpolation du prompt ni attestation de la topologie hôte.

### Livrables

- package xsom-secret-guard-vscode ;
- VSIX de développement ;
- CLI de scan et processus hook partagé par les quatre hôtes pris en charge ;
- intégration VS Code de développement ;
- documentation des limites. L’onboarding attesté, la matrice de versions et la
  couverture Remote/WSL/Container restent futurs.

### Tests

#### Extension

- tests unitaires des presenters sans secret ;
- @vscode/test-electron pour activation, commandes et états ;
- prompt sain routé une seule fois ;
- WARN demande confirmation seulement dans l’UI possédée ;
- HIGH/CRITICAL jamais routés ;
- redaction rescannée et routée uniquement si le verdict final est ALLOW ;
- annulation et fermeture sans persistance.

#### Hooks

- snapshots des contrats VS Code, Claude Code, Codex et Windsurf ;
- merge avec configurations vides, inconnues et multiples ;
- JSON malformé : aucune écriture ;
- backup/rollback ;
- chemins contenant espaces ;
- Windows/macOS/Linux ;
- hook absent, refusé, désactivé ou modifié ;
- CLI killed, timeout et stdout parasite ;
- prompt hostile jamais interpolé dans la commande.

#### UX/accessibilité

- clavier seul ;
- lecteur d’écran sur findings ;
- contrastes et messages ;
- localisation française ;
- aucun secret copié automatiquement ;
- états à 390, 768 et 1440 pixels pour les vues web éventuelles.

### Critères de réussite avant certification

Ces critères restent des gates de sortie, pas des garanties du prototype livré :

- zéro appel du faux provider avant ALLOW ;
- extension p95 ≤ 50 ms pour un prompt ≤ 16 KiB ;
- subprocess CLI 16 KiB p95 ≤ 350 ms sur le runner de CI ; une machine de
  référence publiée et l’end-to-end extension/hôte restent à mesurer ;
- installation/désinstallation sans perte de hook tiers ou contenu préexistant ;
- 100 % des états de couverture corrects dans la matrice ;
- zéro contenu brut dans Output Channel, Developer Console et logs ;
- crash du scanner produit BLOCK dans l’UI possédée ;
- VSIX inspecté ne contient ni secret de test, sourcemap sensible ni dépendance inattendue.

### Principales difficultés

- Agent Hooks VS Code en Preview ;
- UX de WARN impossible avant envoi dans les hooks natifs ;
- comportement de timeout et de préemption VS Code Preview non attesté ;
- localisation réelle du runtime/runner en Remote ;
- contrats Claude/Codex à étudier dans une version future ;
- risque de présenter le participant comme couverture globale.

### Estimation

**18 à 26 jours-personnes**, dont 8–11 pour l’extension, 4–6 pour le CLI, 4–6 pour les hooks et 2–3 pour QA multi-OS.

## 8. Phase 3 — Evaluation

**État : partiellement livrée.** Le runner déterministe couvre 1 150 positifs
synthétiques et 50 000 négatifs générés, rapporte rappel, précision BLOCK, faux
BLOCK/WARN, rejet effectif par défaut et bornes de Wilson, et applique ses seuils
en CI. Il ne constitue pas un corpus public représentatif ou un holdout humain ;
ses taux ne sont pas des claims terrain.

Le run de régression passant observe zéro faux rejet sur ses 50 000 négatifs et
affiche une borne supérieure de Wilson à 95 % de 0,008 %. Cette borne concerne
uniquement les familles synthétiques du script. Elle ne permet aucune
extrapolation populationnelle ; un corpus réel/licencié, dédupliqué, indépendant
et annoté reste obligatoire avant GA ou enterprise.

### Objectif

Mesurer le produit sur un corpus représentatif, supprimer les faux blocages et établir les claims publics autorisés.

### Composants

- corpus positif synthétique ;
- corpus négatif public licencié ;
- corpus de snippets multi-langages ;
- mutations Unicode/encodage/multiline ;
- oracle humain sur les cas ambigus ;
- runner de précision/rappel/latence ;
- comparaison différentielle OSS ;
- rapport de confidentialité.

### Décisions techniques

- séparation train/dev/test même sans ML, par famille fournisseur et seed ;
- aucun secret récolté dans des prompts réels ;
- aucun secret trouvé dans un dépôt public n’est conservé comme fixture ;
- les positifs suivent les grammaires publiques et sont clairement invalidés côté fournisseur ;
- précision/rappel calculés par type, niveau et taille ;
- métrique UX principale : taux de faux BLOCK par prompt ;
- WARN et BLOCK évalués séparément.

### Livrables

- manifest des sources et licences ;
- générateur reproductible avec seeds ;
- dashboard/rapport statique d’évaluation ;
- baseline V0 signée ;
- liste des formats supportés et non supportés ;
- calibration finale des scores ;
- décision go/no-go Marketplace.

### Tests

- absence de doublons entre splits ;
- vérification que les fixtures ne sont pas valides auprès d’un provider, sans envoyer de candidat secret au réseau ;
- revue manuelle en double aveugle des ambiguïtés ;
- tests de stabilité sur trois exécutions ;
- comparaison par taille et OS ;
- test mutation score des détecteurs ;
- recherche du canari dans tous les artefacts d’évaluation.

### Critères de réussite

- seuils Phase 1 confirmés sur le holdout ;
- intervalle de confiance publié pour le faux BLOCK ;
- aucune famille supportée sous 99 % de rappel synthétique sans réduction explicite du claim ;
- tous les cas threat model V0 associés à un test ;
- benchmark reproductible depuis un checkout propre ;
- zéro donnée utilisateur et zéro credential actif ;
- rapport de limites validé par sécurité et produit.

### Principales difficultés

- corpus bénin réellement représentatif ;
- biais d’un dataset construit depuis les mêmes regex ;
- vérification qu’un exemple public n’est pas actif ;
- licence des corpus ;
- taille d’échantillon requise pour démontrer un faible faux BLOCK.

### Estimation

**12 à 18 jours-personnes**. Une partie doit commencer en Phase 1 ; le gate final demande environ deux semaines.

## 9. Phase 4 — Attachments

**État : non livrée et hors V0.**

### Objectif

Étendre la garantie aux fichiers dont Secret Guard contrôle l’extraction et l’envoi, sans confondre scan explicite V0 et interception d’une pièce jointe tierce.

### Composants

- pipeline AttachmentInput ;
- source, .env, .txt et Markdown ;
- JSON, YAML, TOML et CSV ;
- PDF texte local ;
- budgets octets/pages/temps ;
- streaming ou chunking avec recouvrement ;
- provenance page/ligne/colonne ;
- policy MIME/extension ;
- cache éphémère seulement.

### Décisions techniques

- aucun contenu binaire envoyé à un service d’extraction ;
- une pièce jointe native d’une autre extension reste hors couverture sans intégration ;
- pas d’OCR en Phase 4 ;
- parsers en mode safe, sans résolution de tags ou exécution ;
- archives et fichiers chiffrés bloqués/non supportés ;
- tout chunk doit être couvert, avec recouvrement supérieur au token max ;
- dépassement de limite : BLOCK, pas troncature ;
- PDF : texte seulement, limite pages/objets/octets et sandbox processus.

### Livrables

- API scanAttachment ;
- extracteurs locaux ;
- UI de progression/cancel ;
- findings avec provenance de document ;
- corpus de fichiers malformés ;
- documentation de formats/limites ;
- hook/provider intégré uniquement sur les surfaces possédées.

### Tests

- secret début/milieu/fin et à cheval sur deux chunks ;
- .env complet et plusieurs secrets ;
- JSON/YAML/TOML/CSV malformés ;
- Markdown fences et liens ;
- PDF texte multi-pages, objet compressé pathologique, fichier sans texte ;
- zip bomb renommée en PDF ;
- MIME spoofing ;
- annulation ;
- aucune copie dans temp/log ;
- charge CPU/RAM et timeout.

### Critères de réussite

- zéro octet non scanné sur un fichier accepté ;
- 100 % des dépassements bloqués ;
- même rappel que le texte sur contenu extrait ;
- extraction p95 définie par format et affichage de progression au-delà de 100 ms ;
- sandbox et limites validées par fuzz ;
- claims UI limités aux routes réellement contrôlées.

### Principales difficultés

- extraction PDF hostile ;
- frontières de chunks ;
- pièces jointes gérées par d’autres extensions ;
- précision des positions après extraction ;
- latence et taille très supérieures aux prompts.

### Estimation

**20 à 30 jours-personnes** : 10–14 pour formats texte structurés, 6–10 pour PDF, 4–6 pour intégration/QA.

## 10. Phase 5 — ML, uniquement si justifié

**État : non livrée ; aucun modèle n’est embarqué.**

### Objectif

Déterminer si un petit classifieur local réduit les faux WARN/BLOCK génériques sans dégrader rappel, confidentialité, latence ou explicabilité.

### Gate d’entrée

Cette phase se termine immédiatement par « ML non justifié » si :

- les erreurs résiduelles se corrigent par parser/validateur/règle ;
- le corpus ambigu possède moins de 5 000 exemples indépendants ;
- le gain attendu porte sur les signatures structurées ;
- un modèle devrait neutraliser une règle HIGH/CRITICAL ;
- le modèle exige réseau, GPU ou données utilisateur.

### Composants

Si le gate passe :

- dataset synthétique/public, jamais de prompts utilisateurs ;
- classifieur discriminatif de moins de 10 MiB ;
- features lexicales/contextuelles sans valeur persistée ;
- export ONNX ou WebAssembly local ;
- inference seulement sur candidats génériques MEDIUM ;
- explication par reasonCodes ;
- benchmark A/B déterministe vs règles seules.

### Décisions techniques

- pas de SLM génératif ;
- le modèle ne crée pas un finding depuis tout le prompt ;
- il ne réduit jamais HIGH/CRITICAL ;
- il peut seulement convertir certains MEDIUM en LOW ou renforcer MEDIUM ;
- seuils figés sur dev puis évalués une fois sur holdout ;
- artifact signé, versionné et désactivable ;
- inference CPU, offline.

### Livrables

- ADR go/no-go ;
- datasheet du dataset ;
- model card ;
- pipeline d’entraînement reproductible ;
- modèle quantifié si retenu ;
- rapport comparatif ;
- licences et SBOM.

### Tests

- séparation par fournisseur/dépôt/seed ;
- ablation des features proches des regex ;
- précision, rappel, F1 et taux de faux BLOCK ;
- sous-groupes langue/format/longueur ;
- drift sur nouveau corpus ;
- modèle absent/corrompu : règles déterministes seules ou BLOCK selon politique ;
- p95/p99, RSS, taille VSIX ;
- aucune mémorisation détectable des fixtures.

### Critères de réussite

Le modèle est retenu seulement s’il :

- réduit d’au moins 30 % les faux WARN génériques ou améliore la précision d’au moins 2 points ;
- ne baisse pas le rappel des catégories supportées de plus de 0,1 point ;
- n’augmente aucun faux BLOCK critique ;
- ajoute ≤ 5 ms p95 sur les prompts usuels ;
- pèse ≤ 10 MiB ;
- reste explicable et reproductible ;
- passe une revue privacy/supply-chain.

### Principales difficultés

- dataset indépendant des règles ;
- rareté de vrais négatifs difficiles ;
- calibration et drift ;
- taille du bundle ;
- fausse confiance induite par un score ML.

### Estimation

**4 à 6 jours-personnes** pour le gate. Si accepté, **20 à 35 jours-personnes** supplémentaires. Le budget par défaut est zéro tant que Phase 3 ne fournit pas la preuve.

## 11. Phase 6 — Distribution

**État : non livrée.** Un VSIX de développement peut être construit, mais il
n’est ni signé ni publié et aucun SBOM/checksum de release n’est produit.

### Objectif

Publier des artefacts vérifiables, simples à installer et à mettre à jour sans élargir silencieusement les permissions ni la télémétrie.

### Composants

- packages core/cli ;
- VSIX puis VS Code Marketplace ;
- bundles CLI macOS/Linux/Windows ou bundle Node autonome ;
- signature/checksums/provenance ;
- SBOM CycloneDX ou SPDX ;
- channel stable et pre-release ;
- auto-update via Marketplace ;
- marketplace privé/VSIX pour air-gap ;
- télémétrie opt-in.

### Décisions techniques

- versions alignées et matrice core/CLI/extension ;
- build hermétique depuis lockfile ;
- aucune sourcemap source contenant fixture sensible ;
- aucun téléchargement de moteur/règle au runtime V0 ;
- hook manager séparé de l’installation Marketplace et soumis au consentement ;
- clé de publication dans CI, jamais dans le dépôt ;
- rollback documenté ;
- licence du projet décidée avant publication publique.

### Livrables

- VSIX signé et inspecté ;
- publication pre-release Marketplace ;
- checksums et attestations de provenance ;
- SBOM et THIRD_PARTY_NOTICES ;
- guide install/update/uninstall ;
- guide air-gapped ;
- privacy notice et schéma de télémétrie ;
- politique de vulnérabilité et SECURITY.md spécifique.

### Tests

- installation avec [vsce](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) ;
- code --install-extension depuis Marketplace et VSIX ;
- upgrade/downgrade ;
- VSIX offline ;
- signature invalide ;
- package inspection et secret scan ;
- compatibilité trois OS ;
- auto-update Marketplace ;
- VSIX manuel sans auto-update, état affiché ;
- aucune télémétrie avant opt-in ;
- désinstallation qui retire seulement les entrées Secret Guard.

### Critères de réussite

- build reproductible ou différence expliquée ;
- SBOM complet et zéro vulnérabilité High/Critical non acceptée ;
- artefacts signés/checksummés ;
- installation fraîche vers premier scan sain en moins de trois minutes ;
- hook natif activé uniquement après consentement/canari ;
- rollback en moins de dix minutes ;
- Marketplace copy ne promet aucune couverture non démontrée.

### Principales difficultés

- signature et identité publisher ;
- packaging CLI cross-platform ;
- Remote Development ;
- cadence de changement des hooks Preview ;
- auto-update absent par défaut pour un VSIX manuel ;
- licence des règles dérivées.

### Estimation

**10 à 15 jours-personnes**, hors délai administratif Marketplace ou validation publisher.

## 12. Phase 7 — Enterprise

**État : non livrée.** Les policies gérées, règles personnalisées, audit,
télémétrie et gateway décrits ci-dessous sont une trajectoire uniquement.

### Objectif

Transformer Secret Guard en contrôle administrable avec preuve de couverture, règles gérées et egress maîtrisé.

### Composants

- policy engine versionné ;
- custom patterns compilés/validés ;
- allowlists à scope et expiration ;
- règles signées Ed25519 ;
- distribution MDM/marketplace privé ;
- managed hooks VS Code/Claude/Codex ;
- audit metadata-only ;
- console d’administration ;
- provider/gateway ;
- attestation de santé ;
- mode air-gapped ;
- réponse incident et révocation.

### Décisions techniques

- enforced mode repose sur politique hôte + contrôle réseau, pas sur le badge extension ;
- le gateway réapplique une policy au moins aussi stricte ;
- ruleset signé et version minimale monotone ;
- custom regex via moteur sans backtracking ou DSL borné ;
- exceptions CRITICAL réservées à l’administrateur avec motif/expiration ;
- événements centralisés sans prompt/path/secret ;
- export de configuration signé et testable offline ;
- egress direct vers providers interdit par politique réseau pour les postes réglementés.

### Livrables

- schéma PolicyBundle ;
- service de signature/distribution ;
- configuration gérée Claude et requirements.toml Codex ;
- intégration politiques VS Code ;
- gateway adapter ;
- API audit ;
- console pilote ;
- runbooks incident/rollback/rotation ;
- dossier conformité et data-flow map.

### Tests

- tentative de désactivation par utilisateur ;
- downgrade/replay de ruleset ;
- signature invalide/expirée ;
- poste offline ;
- gateway indisponible ;
- divergence policy client/serveur ;
- bypass par provider direct ;
- exception expirée ou scope incorrect ;
- audit sans secret ;
- montée en charge ;
- red team sur agent lisant .env et sorties d’outils.

### Critères de réussite

- aucune route réglementée ne sort sans policy serveur ;
- hooks gérés non désactivables depuis l’UI utilisateur ;
- règles invalides/refusées donnent BLOCK ;
- révocation de ruleset propagée dans le SLO défini ;
- audit démontre action/version/surface sans reconstruire le secret ;
- mode air-gapped fonctionnel ;
- playbooks incident et continuité testés.

### Principales difficultés

- politique homogène entre hôtes ;
- garanties variables des éditeurs ;
- gestion des endpoints et egress réseau ;
- confidentialité de l’audit ;
- haute disponibilité du gateway ;
- support des environnements distants.

### Estimation

**20 à 35 jours-personnes** pour un pilote limité. **60 à 120 jours-personnes** pour un produit enterprise durci, hors intégrations SIEM/MDM spécifiques client.

## 13. Protocole d’évaluation

### 13.1 Construction du corpus

#### Positifs

- générateurs depuis grammaires documentées ;
- valeurs explicitement synthétiques et invalides ;
- credentials composites ;
- faibles mots de passe contextualisés ;
- formats .env/JSON/YAML/TOML/shell/code/prose ;
- mutations casing, espaces, CRLF, Unicode, Base64 et percent.

#### Négatifs

- au moins 50 000 prompts bénins déterministes et annotés pour le gate V0 ;
- UUID, commits SHA, hashes de contenu et SRI ;
- lockfiles et manifests ;
- IDs publics ;
- documentation et snippets ;
- placeholders et templates ;
- fixtures générées ;
- texte multilingue ;
- chaînes aléatoires non secrètes ;
- valeurs proches mais structurellement invalides.

Le runner doit rapporter séparément BLOCK, WARN et le rejet effectif du hook par
défaut (`WARN` ou `BLOCK`). Le gate minimal est zéro BLOCK sur les classes
must-allow et un taux de faux BLOCK global ≤ 0,1 %, avec intervalle de confiance.
Un objectif ≤ 0,01 % ne peut être publié que si la taille du corpus et la borne
supérieure de l’intervalle le démontrent.

#### Séparation

- aucune seed partagée entre dev/test ;
- familles fournisseurs retenues entièrement pour certains tests de généralisation ;
- aucun même fichier public dans deux splits ;
- manifest SHA-256 des fichiers de corpus, jamais des secrets utilisateurs.

### 13.2 Métriques

- précision, rappel et F1 par ruleId/type/niveau ;
- macro et micro moyenne ;
- false BLOCK rate par prompt ;
- false WARN rate ;
- exactitude start/end ;
- taux de redaction propre après rescan ;
- p50/p95/p99 ;
- RSS/CPU/bundle/VSIX ;
- cold vs warm ;
- stabilité inter-OS ;
- taux de surface effectivement PROTECTED.

### 13.3 Reporting

Chaque résultat publie :

- commit ;
- version Node/VS Code/hôte ;
- CPU/RAM/OS ;
- version ruleset ;
- hash du manifest corpus ;
- commande reproductible ;
- intervalles de confiance ;
- écarts vs baseline et seuils de CI.

## 14. Benchmark OSS et licences

Vérifié le 11 septembre 2026. Une licence autorise potentiellement la réutilisation ; elle ne remplace ni la revue juridique ni les obligations d’attribution.

| Projet                                                                                                                          | Licence/source primaire                                                     | Apport                                                                                         | Limite pour le prompt temps réel                                                                | Décision                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [Gitleaks](https://github.com/gitleaks/gitleaks)                                                                                | [MIT](https://github.com/gitleaks/gitleaks/blob/master/LICENSE)             | Catalogue mature, mots-clés, formats, entropie, stdin                                          | Go, orienté repo/CLI, sorties pouvant inclure la valeur, catalogue trop large pour BLOCK direct | Oracle différentiel ; porter un sous-ensemble avec notice et tests, pas de binaire runtime V0    |
| [Titus](https://github.com/praetorian-inc/titus)                                                                                | [Apache-2.0](https://github.com/praetorian-inc/titus/blob/main/LICENSE)     | Scanner haute performance, bibliothèque/serveur, règles nombreuses                             | Binaire natif/Go, validation live à désactiver, distribution plus lourde                        | Challenger benchmark hors runtime                                                                |
| [TruffleHog](https://github.com/trufflesecurity/trufflehog)                                                                     | [AGPL-3.0](https://github.com/trufflesecurity/trufflehog/blob/main/LICENSE) | Grande taxonomie, credentials composites, validation                                           | Copyleft fort, moteur Go, vérification réseau et résultats bruts incompatibles avec le hot path | Inspiration et oracle externe seulement sans validation réseau ; revue juridique avant tout code |
| [detect-secrets](https://github.com/Yelp/detect-secrets)                                                                        | [Apache-2.0](https://github.com/Yelp/detect-secrets/blob/master/LICENSE)    | Plugins, filtres UUID/template, entropie, baseline                                             | Runtime Python et logique repo ; certains heuristiques peuvent perdre des mots de passe faibles | Réutiliser concepts/tests avec NOTICE, pas runtime                                               |
| [Secretlint](https://github.com/secretlint/secretlint)                                                                          | [MIT](https://github.com/secretlint/secretlint/blob/master/LICENSE)         | Écosystème TypeScript, plugins, benchmark                                                      | Couverture initiale moindre et orientation lint/commit                                          | Témoin d’intégration et benchmark ; dépendances évaluées séparément                              |
| [GitHub Secret Scanning](https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns) | Service/documentation, pas moteur OSS                                       | Séparation détection large / push protection haute confiance, custom patterns et bypass audité | Patterns et implémentation non copiables comme OSS                                              | Benchmark comportemental et principes produit uniquement                                         |
| [google/re2-wasm](https://github.com/google/re2-wasm)                                                                           | [Apache-2.0](https://github.com/google/re2-wasm/blob/main/LICENSE)          | Regex sans backtracking catastrophique, portable Node/Web                                      | Binaire Wasm, initialisation, syntaxe sans lookahead/backreference, package à revoir            | Spike avant custom rules ; embarquer seulement si gates perf/supply-chain                        |

### 14.1 Règles de réutilisation

- épingler commit/version et checksum ;
- conserver copyright, licence et NOTICE requis ;
- déclarer la provenance de chaque famille de règles ;
- ne pas copier les patterns GitHub documentés comme s’ils étaient sous licence OSS ;
- ne pas intégrer de code AGPL dans un artefact sous une licence incompatible sans décision juridique explicite ;
- distinguer Gitleaks du produit Gitleaks Action, qui possède des conditions différentes ;
- convertir chaque règle avec des tests de sémantique, pas par traduction aveugle RE2 → JavaScript ;
- retirer toute fixture contenant un credential actif ;
- scanner les artefacts et dépendances à chaque release.

### 14.2 Décision de licence Secret Guard

Le plan ne suppose aucune licence actuelle. Avant publication :

1. choisir explicitement la licence du core ;
2. décider si extension/CLI ont la même licence ;
3. valider la compatibilité MIT/Apache-2.0 ;
4. inclure THIRD_PARTY_NOTICES ;
5. documenter les règles dérivées ;
6. faire valider tout usage de TruffleHog/AGPL par conseil juridique.

Une option pragmatique est Apache-2.0 pour le core afin d’inclure une clause brevets, mais cette décision appartient au propriétaire du produit et doit être enregistrée.

## 15. CI/CD actuel et cible

### Actuellement exécuté

`npm run verify` exécute format check, lint, typecheck, couverture core avec
seuils 90 % lignes/statements/fonctions et 85 % branches, build, contrats
subprocess CLI/hook, smoke Extension Host, inspection allowlist et comparaison
SHA-256 interne du VSIX, évaluation synthétique 1 150/50 000, fuzz smoke 100 000,
dogfood, benchmarks core 16/256/1 024 KiB et CLI 16 KiB, puis `npm audit`. Cela
ne produit ni SBOM, ni checksum de release signé/provenance, ni preuve
d’interception VS Code, ni corpus représentatif annoté.

### Cible pull request avant certification

- format/lint/typecheck ;
- unit/property tests ;
- tests de non-divulgation ;
- fuzz smoke ;
- benchmark court avec seuil de régression ;
- audit dépendances ;
- génération SBOM ;
- inspection des licences ;
- build core/CLI/VSIX ;
- scan du VSIX et recherche de canaris.

### Cible nightly

- fuzz prolongé ;
- corpus complet ;
- tests multi-OS ;
- @vscode/test-electron sur versions min/courante/Insiders ;
- hooks Claude/Codex seulement lorsqu’une version future les déclarera supportés ;
- benchmark différentiel OSS ;
- audit supply-chain.

### Cible release

- checkout propre et lockfile ;
- build reproductible ;
- suite complète ;
- signature/checksums/provenance ;
- publication pre-release ;
- canari Marketplace/VSIX ;
- promotion stable manuelle ;
- rollback prêt.

## 16. Jalons et dépendances

```text
P0 Recherche
 ├──> P1 Core ───────────┐
 └──> Harness hooks ──┐  │
                      ▼  ▼
                    P2 VS Code
                       │
                       ▼
                    P3 Evaluation ──> MVP public limité
                       │
          ┌────────────┼──────────────┐
          ▼            ▼              ▼
       P4 Files     P5 ML gate     P6 Distribution
          └────────────┴──────┬───────┘
                              ▼
                         P7 Enterprise
```

P3 commence pendant P1, mais son holdout reste fermé jusqu’au gel du ruleset. P6 peut préparer le pipeline tôt, sans publier avant les gates P3.

## 17. Estimation consolidée

Hypothèse : deux engineers seniors TypeScript/plateforme, avec 0,5 équivalent sécurité/QA. Les chiffres sont des jours-personnes, pas des jours calendaires.

| Lot                          | Complexité  | Estimation |
| ---------------------------- | ----------- | ---------: |
| Recherche et contrats hôtes  | Élevée      |      5–8 j |
| Core et ruleset V0           | Très élevée |    20–30 j |
| CLI/adaptateurs hooks        | Élevée      |      4–6 j |
| Extension et UX              | Élevée      |     8–11 j |
| Hook manager multi-OS/Remote | Très élevée |      4–6 j |
| Évaluation/faux positifs     | Très élevée |    12–18 j |
| Packaging initial/VSIX       | Moyenne     |      3–5 j |
| Pièces jointes structurées   | Élevée      |    10–14 j |
| PDF texte hostile            | Très élevée |     6–10 j |
| ML gate                      | Moyenne     |      4–6 j |
| ML si accepté                | Très élevée |    20–35 j |
| Distribution générale        | Élevée      |    10–15 j |
| Pilote enterprise            | Très élevée |    20–35 j |
| Enterprise durci             | Très élevée |   60–120 j |

**MVP Phases 0–3 : 55 à 82 jours-personnes**, soit environ **7 à 10 semaines calendaires** avec l’équipe ci-dessus, sous réserve d’accès aux versions hôtes et aux machines multi-OS.

Un prototype peut apparaître en deux semaines ; il ne doit pas être confondu avec un contrôle de sécurité publiable.

## 18. Les dix décisions finales

### 1. Est-ce techniquement faisable ?

**Oui, avec une portée explicite.** Il est faisable de bloquer avant egress dans une interface possédée, un hook UserPromptSubmit actif ou un provider/gateway contrôlé. Il n’est pas faisable pour une extension standard d’intercepter universellement toutes les webviews et commandes d’assistants.

### 2. Quelle est la meilleure architecture ?

**Core TypeScript local + CLI de hooks sur stdin/stdout + extension VS Code**, complétés plus tard par provider/gateway. La politique est séparée des détecteurs, les résultats ne contiennent pas la valeur et la couverture est suivie par surface.

### 3. Faut-il entraîner un modèle ?

**Non au V0.** Regex structurées, parseurs, validateurs, contexte et entropie ciblée sont plus rapides, fiables et explicables. Le ML n’est autorisé qu’après Phase 3 et seulement sur les candidats génériques MEDIUM avec un gain mesuré.

### 4. Peut-on atteindre une latence perçue comme instantanée ?

**Le prototype paraît rapide sur son benchmark étroit, sans preuve générale.** Les
gates actuels du core chaud sont : 16 KiB p95/p99 15/30 ms, 256 KiB 75/125 ms et
1 MiB 250/400 ms, sur texte ASCII sain. Vingt subprocess CLI de 16 KiB ont aussi
un gate p95 ≤ 350 ms. La RSS, le CPU, les secrets/quasi-candidats et l’extension
de bout en bout ne sont pas mesurés ; aucune promesse « instantanée » n’est
publiée.

### 5. Jusqu’où protéger Claude Code, Codex et Copilot depuis VS Code ?

- **Participant `@secretguard` :** route UI historique encore disponible ; WARN
  brut confirmé explicitement ou redaction rescannée ALLOW.
- **VS Code/Copilot Agent compatible hooks :** fichier UserPromptSubmit Preview
  configurable, mais interception non attestée. Workspace Trust, workspace,
  policies et Remote peuvent le préempter.
- **Claude Code CLI/IDE, Codex CLI/IDE et Windsurf :** hooks utilisateur
  pré-submit installés et canaris locaux validés, sans attestation d’invocation
  par l’hôte ni résistance à un utilisateur qui les retire.
- **Autres assistants :** seulement avec participant, intégration directe, provider ou proxy.

L’extension seule ne suffit pas.

### 6. Quel est le MVP exact ?

- core V0 déterministe ;
- participant `@secretguard` ;
- scan explicite du presse-papiers, sélection et document texte ;
- CLI de scan et processus hook partagé par VS Code/Copilot, Claude Code, Codex
  et Windsurf ;
- HIGH/CRITICAL bloqués dans la route possédée ; MEDIUM envoyé brut uniquement
  après confirmation explicite, et bloqué par défaut dans le hook ;
- redaction + rescan fail-closed ; `content` vide et aucun envoi si le verdict
  final n’est pas complet et ALLOW ;
- statut config/intégrité/canari local uniquement, sans attestation de couverture
  par l’hôte ;
- 1 MiB fail-closed ;
- aucune pièce jointe native, PDF, OCR, repo scan ou ML.

### 7. Que réutiliser en open source ?

- concepts et sous-ensemble de règles Gitleaks sous MIT, avec attribution ;
- filtres/architecture detect-secrets sous Apache-2.0 ;
- Secretlint comme référence TypeScript ;
- Titus comme challenger de performance ;
- RE2-Wasm seulement s’il réussit les gates.

TruffleHog reste un oracle externe en raison de l’AGPL et de sa logique de vérification. GitHub Secret Scanning inspire le produit, mais n’est pas un moteur OSS à copier.

### 8. Quel moat potentiel ?

Le moat n’est pas la regex. Il réside dans :

- une future couverture multi-hôtes prouvée et honnête ;
- le corpus de faux positifs orienté prompts ;
- la policy explicable et versionnée ;
- la redaction sans fuite ;
- l’attestation de couverture ;
- l’administration/gateway multi-agent ;
- la qualité des intégrations et des evals.

### 9. Combien de temps et quelle complexité ?

L’estimation initiale d’un MVP certifiable reste **55–82 jours-personnes** ; le
prototype présent n’implique pas que ce travail soit terminé. Les parties les plus
difficiles sont les faux positifs, l’exactitude des offsets après transformations,
les contrats hôtes et l’assurance qu’aucun secret ne fuit par les logs.
L’enterprise durci ajoute **60–120 jours-personnes**.

### 10. Quelle architecture mène à l’enterprise ?

La cible ferait évoluer le même core pour recevoir un PolicyBundle signé. Le CLI
et l’extension fourniraient le contrôle local ; des hooks gérés limiteraient les
désactivations opportunistes ; un provider/gateway obligatoire réappliquerait la
politique sur tout egress réglementé ; un audit metadata-only et une attestation
de santé apporteraient la preuve. Seuls le contrôle réseau et les politiques des
hôtes, pas l’extension seule, pourraient créer cet enforced mode futur.

## 19. Sources primaires

### VS Code

- [VS Code 1.137](https://code.visualstudio.com/updates/v1_137)
- [Extension Capabilities — no DOM access](https://code.visualstudio.com/api/extension-capabilities/overview)
- [Agent Hooks — Preview](https://code.visualstudio.com/docs/agent-customization/hooks)
- [Hooks Reference — UserPromptSubmit](https://code.visualstudio.com/docs/agents/reference/hooks-reference#_userpromptsubmit)
- [Chat Participant API](https://code.visualstudio.com/api/extension-guides/ai/chat)
- [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider)
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Extension Marketplace et VSIX](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace)

### Assistants

- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code managed hook configuration](https://code.claude.com/docs/en/configuration#hook-configuration)
- [Claude Code VS Code integration](https://code.claude.com/docs/en/ide-integrations)
- [Codex Hooks](https://learn.chatgpt.com/fr-FR/docs/hooks)
- [Codex configuration CLI/IDE et maturité](https://learn.chatgpt.com/fr-FR/docs/config-file/config-basic)

### Détection et licences

- [Gitleaks](https://github.com/gitleaks/gitleaks) — [MIT](https://github.com/gitleaks/gitleaks/blob/master/LICENSE)
- [Titus](https://github.com/praetorian-inc/titus) — [Apache-2.0](https://github.com/praetorian-inc/titus/blob/main/LICENSE)
- [TruffleHog](https://github.com/trufflesecurity/trufflehog) — [AGPL-3.0](https://github.com/trufflesecurity/trufflehog/blob/main/LICENSE)
- [detect-secrets](https://github.com/Yelp/detect-secrets) — [Apache-2.0](https://github.com/Yelp/detect-secrets/blob/master/LICENSE)
- [Secretlint](https://github.com/secretlint/secretlint) — [MIT](https://github.com/secretlint/secretlint/blob/master/LICENSE)
- [GitHub supported secret-scanning patterns](https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns)
- [GitHub custom patterns](https://docs.github.com/en/code-security/reference/secret-security/custom-patterns)
- [GitHub push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection)
- [google/re2-wasm](https://github.com/google/re2-wasm) — [Apache-2.0](https://github.com/google/re2-wasm/blob/main/LICENSE)
