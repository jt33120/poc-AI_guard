# Secret Guard — Threat model

**Statut :** modèle de menace de l’implémentation V0.2 livrée, avec gaps de release explicites

**Référence :** SG-TM-001

**Date :** 11 septembre 2026

**Dépendance :** [ARCHITECTURE.md](./ARCHITECTURE.md)

**Runtime validé :** Node.js 22.13 ou plus récent

## 1. Objectif de sécurité

Le core Secret Guard analyse localement une chaîne et rend un verdict sans inclure
la valeur détectée. Dans le V0.2, les hooks natifs configurés contrôlent le champ
prompt texte avant son traitement par VS Code/Copilot, Claude Code, Codex ou
Windsurf ; le participant `@secretguard` reste une surface possédée de diagnostic.

La propriété recherchée est :

> Dans le participant possédé, aucun routage n’a lieu après BLOCK, scan incomplet
> ou erreur. Un WARN brut ne peut être routé qu’après confirmation explicite de
> l’utilisateur pour cette requête. Une version expurgée n’est routée que si son
> rescan exact retourne `complete:true` et `ALLOW`.

Le hook VS Code est un mécanisme **Preview**. Le V0.2 vérifie localement le runner
copié avec un prompt sain et un secret synthétique sur deux enveloppes, mais ces
canaris ne prouvent pas qu’un hôte a intercepté un prompt réel. Les politiques
gérées, la version de l’hôte et un Extension Host distant peuvent préempter les
fichiers utilisateur. Le V0.2 n’offre aucune promesse universelle.

## 2. Périmètre de confiance

### 2.1 Actifs

- secrets saisis ou collés par le développeur ;
- credentials présents dans une sélection ou un fichier explicitement scanné ;
- prompt redacted avant transmission ;
- règles, validateurs et politiques de décision ;
- configurations utilisateur des quatre hooks natifs ;
- intégrité des sources, du bundle CLI et du VSIX.

### 2.2 Composants de confiance

- secret-guard-core et son catalogue de patterns statiques revus ;
- secret-guard-cli dans les contrats effectivement testés ;
- secret-guard-vscode lorsqu’elle traite sa propre interface ;
- pipeline de build et lockfile du workspace.

### 2.3 Composants semi-fiables

- VS Code et son Extension Host ;
- les quatre hôtes et leurs mécanismes pre-submit documentés ;
- fichiers de configuration utilisateur/projet ;
- environnement Remote SSH, WSL, Container ou Codespaces ;
- parsers de formats et dépendances tierces ;
- autres extensions installées.

### 2.4 Composants non fiables

- prompt, presse-papiers, fichiers et noms de variables ;
- dépôt ouvert, y compris hooks et configuration versionnés ;
- chaînes Unicode, encodées ou volontairement pathologiques ;
- réponse d’un hook tiers ;
- provider LLM et réseau, au regard du secret avant redaction ;
- ruleset téléchargé non signé ;
- télémétrie ou crash reporter externe ;
- toute extension ou executable hors de la chaîne attestée.

## 3. Acteurs et intentions

| Acteur                       | Capacité                                                          | Intention prise en compte                             |
| ---------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| Développeur pressé           | Colle un secret ou un .env, contourne un warning                  | Accident principal du V0                              |
| Développeur curieux          | Désactive un hook ou ajoute une exception large                   | Contournement local non sophistiqué                   |
| Dépôt malveillant            | Fournit Unicode hostile, gros fichiers, config ou script trompeur | Bypass, DoS, détournement de hook                     |
| Auteur d’une autre extension | Lit le presse-papiers ou envoie hors du chemin protégé            | Exfiltration hors couverture                          |
| Attaquant supply-chain       | Altère VSIX, CLI, dépendance ou ruleset                           | Désactivation ou vol du secret en mémoire             |
| Administrateur mal configuré | Déploie une règle trop large ou un chemin absent                  | Fuite ou blocage généralisé                           |
| Attaquant local privilégié   | Modifie processus, mémoire ou config                              | Hors objectif de défense fort V0                      |
| Provider compromis           | Conserve un contenu déjà envoyé                                   | Réduit par blocage pré-egress, pas traité après envoi |

Le V0 est conçu d’abord contre l’accident et les bypass triviaux. Il ne prétend pas résister à un administrateur root, à un poste compromis ou à un utilisateur déterminé qui choisit un autre client.

## 4. Frontières de données

```text
[Entrée non fiable]
 prompt / presse-papiers / fichier / événement de hook
                 │
                 ▼
       B1 : validation + limite core de 1 MiB UTF-8
                 │
                 ▼
       B2 : normalisation / décodage
                 │
                 ▼
       B3 : détection / décision locale
                 │
          ┌──────┴──────┐
          │             │
       BLOCK       ALLOW ou WARN confirmé
          │             │
 [raison minimale]  B4 : routeur explicite
                        │
                        ▼
                [Provider non fiable]
```

Autres frontières :

- B5 : extension vers processus CLI via stdin/stdout ;
- B6 : extension vers configuration de hooks ;
- B7 : build vers VSIX ;
- B8 : politiques workspace/administrateur pouvant préempter le hook.

## 5. Invariants non négociables

### SG-INV-01 — Pas d’egress sans verdict admissible

Dans le participant possédé, BLOCK, scan incomplet et exception ne routent rien.
Un WARN brut exige le choix explicite « Envoyer quand même ». Après redaction, la
politique exige ALLOW ; le dispatch refuse tout verdict final WARN, BLOCK ou
incomplet.

### SG-INV-02 — Aucun secret brut journalisé

La valeur détectée et tout extrait qui la révèle sont interdits dans :

- logs applicatifs ;
- stdout et stderr de décision du CLI ; `scan --redact` émet volontairement le
  contenu expurgé fourni par l’utilisateur ;
- télémétrie, inexistante dans le V0 ;
- traces de performance ;
- crash reports ;
- noms de fichiers ;
- arguments de processus ;
- variables d’environnement ;
- événements d’audit ;
- snapshots de test approuvés ;
- exceptions et messages utilisateur.

Cette exigence répond notamment à [CWE-532 — Insertion of Sensitive Information into Log File](https://cwe.mitre.org/data/definitions/532.html).

### SG-INV-03 — Plus de 1 MiB : BLOCK

Toute entrée dont le texte UTF-8 dépasse 1 048 576 octets est bloquée avec le
ruleId `input_too_large` et `complete:false`. Il n’existe aucun chemin qui scanne
un préfixe puis autorise la partie restante.

Le JSON de hook possède une petite enveloppe additionnelle autorisée, mais le champ prompt reste limité séparément. Un dépassement pendant la lecture de stdin interrompt la lecture et bloque.

### SG-INV-04 — Pas de valeur dans ScanResult

Le résultat contient uniquement :

- ruleId et catégorie ;
- sévérité/action ;
- offsets, ligne et colonne ;
- codes d’explication ;
- version du ruleset ;
- état `complete`, taille UTF-8 et version compilée du ruleset.

Il ne contient ni valeur, ni snippet, ni hash simple de la valeur.

### SG-INV-05 — Fail-closed local

Argument runtime invalide, entrée supérieure à 1 MiB, dépassement du plafond de
findings ou exception interne donnent un résultat `BLOCK`, `complete:false`. Le V0
n’a ni ruleset externe, ni checksum, ni budget wall-clock. Un crash du processus,
un timeout ou l’ignorance du hook par VS Code restent hors de cette garantie.

### SG-INV-06 — Déterminisme

À texte, source, politique et ruleset identiques, le résultat est identique. Il n’existe ni appel réseau, ni horloge, ni aléa dans la décision.

### SG-INV-07 — Redaction totale des plages

`redact` fusionne les plages valides chevauchantes ou adjacentes, puis les remplace
de droite à gauche par `<REDACTED_ruleId>`. `redactAndRescan` retourne les verdicts
initial et final, mais ne rend le texte expurgé dans `content` que si le scan
initial est complet et si le rescan final est complet et ALLOW. Dans tous les
autres cas, `content` vaut `""`.

### SG-INV-08 — Couverture explicite

Le V0.2 affiche « actif » seulement si les quatre entrées gérées sont exactes, le
runner installé correspond au bundle et les canaris locaux réussissent. Il
affiche « partiel », « dégradé » ou « désactivé » dans les autres cas. Le cadenas
est un témoin local : il n’atteste ni le chargement effectif par chaque hôte, ni
une politique système/MDM, ni une couverture des pièces jointes.

## 6. Cas d’abus et contrôles

| ID     | Cas                                     | Risque                                | Contrôles V0                                                                                                                       | Résiduel / suite                                                                     |
| ------ | --------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| SG-T01 | Clé API évidente                        | Exfiltration directe                  | Préfixe fournisseur, RegExp JavaScript statique, longueur/alphabet, BLOCK                                                          | Formats inconnus restent contextuels                                                 |
| SG-T02 | Mot de passe faible sous PASSWORD       | Faible entropie non détectée          | Parseur d’affectation + nom sensible + valeur non placeholder, HIGH                                                                | Prose ambiguë peut créer WARN                                                        |
| SG-T03 | JWT                                     | Jeton utilisable envoyé               | Trois segments, décodage borné du header/payload, validation Base64url, HIGH                                                       | JWT d’exemple peut nécessiter filtre documenté                                       |
| SG-T04 | Clé privée PEM multiligne               | Credential critique                   | Détection begin/end, type de clé, contenu borné, CRITICAL                                                                          | Format propriétaire non PEM hors couverture                                          |
| SG-T05 | Secret Base64                           | Signature masquée                     | Un niveau Base64, 16 384 octets de sortie par opération, budget global de 128 tentatives et 262 144 octets estimés                 | Double Base64 hors V0                                                                |
| SG-T06 | Token coupé sur plusieurs lignes        | Bypass trivial                        | Reconstruction bornée si préfixe/contexte fort et espaces limités                                                                  | Découpage arbitraire hors V0                                                         |
| SG-T07 | Credentials dans URL                    | User/password envoyés                 | Parseur URL, schéma base de données/cloud, percent-decode borné, HIGH                                                              | Valeurs injectées par template non résolu                                            |
| SG-T08 | Secret dans code                        | Copie d’un snippet                    | Regex et affectations textuelles, offsets originaux, règles spécifiques                                                            | Aucun AST multi-langage                                                              |
| SG-T09 | .env entier                             | Plusieurs credentials                 | Affectations textuelles + findings multiples + BLOCK si un seul HIGH                                                               | Ce n’est pas un parseur `.env` complet ; pièce jointe tierce non interceptée         |
| SG-T10 | Plusieurs secrets, plages chevauchantes | Redaction partielle                   | Union des plages adjacentes/chevauchantes et rescan final obligatoirement ALLOW                                                    | Nombre de findings plafonné puis BLOCK                                               |
| SG-T11 | Chaîne proche d’un vrai token           | Faux blocage                          | Validateurs structurels, score d’évidence, corpus négatif difficile                                                                | WARN possible dans UI possédée                                                       |
| SG-T12 | UUID, SHA, SRI, lockfile                | Faux positif fréquent                 | Filtres de forme UUID/hash/SRI/ULID                                                                                                | Aucun parseur de lockfile ; un secret peut imiter un hash                            |
| SG-T13 | Fake/test/example/placeholder           | Friction développeur                  | Placeholders et trois exemples publics exacts compilés ; références non quotées filtrées pour une liste fermée de langages de code | Aucun allègement lié au contexte test/fixture ; une signature fixe reste prioritaire |
| SG-T14 | Unicode NFKC, zero-width ou bidi        | Contournement des signatures          | NFKC par point de code et retrait de `Default_Ignorable_Code_Point` avec mapping                                                   | Homoglyphes complexes hors V0                                                        |
| SG-T15 | Obfuscation simple par espaces/percent  | Bypass trivial                        | Percent-decode et jointure contextuelle bornée                                                                                     | Chiffrement, XOR et scripts reconstructeurs hors V0                                  |
| SG-T16 | Entrée > 1 MiB                          | Tail non scannée ou DoS               | Mesure UTF-8 avant analyse, BLOCK intégral                                                                                         | L’utilisateur doit réduire ou passer au scanner V1                                   |
| SG-T17 | Très grand nombre de candidats          | CPU/mémoire                           | 128 tentatives de décodage et 262 144 octets de sortie estimés globalement ; 128 fenêtres jointes ; 2 048 findings ; limite 1 MiB  | Aucun budget wall-clock/RSS                                                          |
| SG-T18 | Regex hostile / ReDoS                   | Gel avant envoi                       | Patterns statiques bornés, tests hostiles ciblés et smoke fuzz déterministe de 100 000 cas                                         | Pas de fuzz coverage-guided ni preuve générale de complexité                         |
| SG-T19 | JSON de hook malformé                   | Bypass par parser                     | `JSON.parse`, objet non nul et `prompt` string requis ; sinon stdout vide et exit 2                                                | Champs inconnus acceptés ; contrat hôte Preview non certifié                         |
| SG-T20 | Injection shell via prompt              | Exécution locale                      | Prompt uniquement sur stdin, jamais interpolé dans commande/args/env                                                               | Mauvaise configuration manuelle externe                                              |
| SG-T21 | Hook absent/désactivé/non fiable        | Fausse impression de protection       | États off/actif/partiel/dégradé fondés sur config, intégrité et canaris locaux                                                      | Aucune attestation que l’hôte invoque ou respecte le hook                            |
| SG-T22 | Timeout du hook                         | Prompt transmis sans verdict          | Timeout hôte configuré à 30 s et canari local borné à 5 s par appel                                                                | Comportement de timeout de l’hôte non attesté                                        |
| SG-T23 | Hook Claude/Codex absent ou préempté    | Opération non bloquée                 | Installation native pré-submit, fusion conservatrice des configurations et état par hôte                                           | Hook utilisateur supprimable ; politique gérée requise pour une obligation d’entreprise |
| SG-T24 | Remote Extension Host différent         | Runtime/runner absent sur l’hôte réel | Runner copié dans le stockage global de l’Extension Host actif ; limite documentée                                                 | Aucune attestation de topologie ou du lieu utilisé pour le prompt                    |
| SG-T25 | Agent lit .env après le prompt          | Secret exposé sans être tapé          | Hors promesse V0 ; avertissement clair                                                                                             | PreToolUse/gateway V1 requis                                                         |
| SG-T26 | Pièce jointe native tierce              | Contenu non visible par hook prompt   | Hors promesse V0 ; état de surface explicite                                                                                       | Provider ou intégration directe V1                                                   |
| SG-T27 | Presse-papiers surveillé globalement    | Atteinte vie privée                   | Lecture uniquement après commande explicite, aucun historique                                                                      | Autre extension malveillante hors contrôle                                           |
| SG-T28 | Règle/extension altérée                 | Faux ALLOW ou vol en mémoire          | lockfile npm, allowlist VSIX, comparaison SHA-256 bundle/artefact et digest affiché                                                | Pas de signature, SBOM ni checksum de release publié                                 |
| SG-T29 | Ruleset custom trop permissif           | Désactivation déguisée                | Aucun ruleset custom accepté au V0                                                                                                 | Policies gérées futures                                                              |
| SG-T30 | Allowlist par hash devinable            | Brute force offline                   | Aucune exception persistante au V0                                                                                                 | HMAC/stockage futur                                                                  |
| SG-T31 | Race après scan / avant envoi           | Texte modifié après ALLOW             | Sceller l’objet texte scanné ; router exactement la même chaîne                                                                    | API tierce non possédée hors contrôle                                                |
| SG-T32 | Message de blocage reflète le prompt    | Secret affiché/loggé par l’hôte       | Messages à catégories/positions et raisons constantes                                                                              | Aucun contrat Claude `suppressOriginalPrompt` au V0                                  |
| SG-T33 | Télémétrie trop détaillée               | Ré-identification                     | Aucune télémétrie implémentée                                                                                                      | Schéma opt-in futur à revoir                                                         |
| SG-T34 | Downgrade de core/ruleset               | Réintroduction d’un bypass            | Ruleset compilé et version exposée                                                                                                 | Pas de signature/version monotone ni canal géré                                      |

## 7. Menaces propres aux frontières d’interception

### 7.1 VS Code

Les hooks VS Code sont Preview et configurables. Le contrat documenté traite le code 2 comme bloquant et les autres codes non nuls comme avertissements non bloquants ; voir [Agent Hooks](https://code.visualstudio.com/docs/agent-customization/hooks#_exit-codes). Secret Guard :

- utilise exit `2`, stdout vide et une raison non sensible sur stderr pour tout
  refus du processus `hook`; la commande `secret-guard scan` utilise elle aussi
  exit `2` pour BLOCK ;
- cible VS Code 1.136 pour l’extension et le contrat Agent Hooks disponible à
  partir de VS Code 1.137 Preview, sans encore posséder un test d’interception
  hôte de bout en bout ;
- ne s’appuie pas sur une API proposed pour le Marketplace ;
- ne prétend pas protéger une webview tierce ;
- écrit une configuration utilisateur dédiée, sans pouvoir garantir sa priorité
  face à [Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust), au workspace ou à une policy gérée.

La configuration générée utilise les chemins absolus de l’exécutable et du hook
copié. L’extension compare le hook installé au bundle et teste son contrat local,
mais cela n’atteste ni le binaire Node lui-même ni l’ordre effectif des hooks côté
hôte.

### 7.2 Claude Code

Le [contrat UserPromptSubmit Claude](https://code.claude.com/docs/en/hooks#userpromptsubmit)
est installé dans `~/.claude/settings.json`. Secret Guard ajoute uniquement son
entrée marquée, conserve les autres réglages/hooks et valide localement les cas
sain et bloqué avant activation. Ce contrôle ne prouve pas que Claude a chargé
la configuration ni qu’un administrateur local ne l’a pas retirée.

### 7.3 Codex

Les [Hooks Codex](https://learn.chatgpt.com/fr-FR/docs/hooks) fournissent UserPromptSubmit et un blocage par JSON ou code 2. Les hooks non gérés exigent une revue de confiance ; les hooks projet sont ignorés dans un projet non fiable. Les hooks MCP ne bloquent pas sur erreur/absence.

Secret Guard ajoute son entrée marquée dans `~/.codex/hooks.json`, préserve les
hooks existants et utilise le même runner fail-closed. La confiance, la priorité
des configurations et l’invocation réelle restent du ressort de l’hôte ; une
configuration gérée par l’organisation est nécessaire pour rendre le hook non
désactivable par l’utilisateur.

### 7.4 Provider/gateway

Le provider/gateway est la frontière forte uniquement pour le trafic qui lui est effectivement routé. Menaces supplémentaires :

- double scan avec policies divergentes ;
- perte de disponibilité ;
- logging accidentel du body ;
- bypass par provider direct.

Contrôles futurs :

- même ruleset/version ou règle de dominance serveur ;
- endpoint n’acceptant pas de requête sans attestation de version ;
- body logging désactivé ;
- egress réseau d’entreprise limité aux providers approuvés ;
- audit de décision sans payload.

## 8. Normalisation Unicode

La normalisation suit [Unicode Standard Annex #15](https://unicode.org/reports/tr15/) et les considérations de sécurité d’[Unicode Technical Report #36](https://unicode.org/reports/tr36/).

Comportement livré :

- analyser l’original et une vue NFKC ;
- retirer tout point de code ayant la propriété Unicode
  `Default_Ignorable_Code_Point` dans la vue normalisée ;
- garder un mapping vers les offsets UTF-16 originaux ;
- ne jamais afficher la chaîne normalisée ;
- ne pas confondre homoglyphes Unicode arbitraires avec une translittération sûre.

La normalisation NFKC est appliquée point de code par point de code. Le retrait
fondé sur cette propriété couvre plus que les seuls contrôles bidi ; il peut donc
modifier des marques de variation ou d’autres caractères ignorables. Il ne s’agit
pas d’un parseur Unicode de sécurité complet. Les homoglyphes arbitraires restent
hors garantie V0.

## 9. Encodages et limites anti-expansion

Le V0 implémente :

- Base64/Base64url si longueur, alphabet et padding sont plausibles ;
- percent-encoding UTF-8 strict sur une vue du texte, avec conservation
  littérale des séquences invalides ;
- échappements JSON Unicode `\\uXXXX` et slash `\/` ;
- un passage de chaque transformateur textuel, composable dans les deux ordres et
  suivi d’une nouvelle normalisation ;
- aucune récursion Base64, décompression ou exécution.

Limites réellement codées :

- profondeur Base64 maximale : 1 ;
- candidat Base64 source : 20 à 16 384 caractères ;
- sortie Base64 : 16 384 octets au maximum par candidat ;
- 128 tentatives/opérations de décodage et 262 144 octets de sortie estimés et
  budgétés sur l’ensemble du scan, y compris segments JWT et auth Docker ;
- 128 fenêtres de jointure multiligne de 16 384 caractères au plus ;
- findings : 2 048 avant échec fermé ;
- PEM : bloc entier jusqu’au footer correspondant dans l’entrée bornée à 1 MiB,
  ou de l’en-tête à la fin si le footer manque.

Il n’existe pas de ratio d’expansion configurable ni de budget wall-clock. Une
entrée globale supérieure à 1 MiB UTF-8 donne toujours le finding
`input_too_large` et `complete:false`. Le dépassement d’un budget Base64 produit un
échec fermé plutôt qu’un ALLOW partiel.

## 10. Faux positifs et exceptions

### 10.1 Ordre de décision

1. reconnaître une signature fournisseur complète ;
2. valider sa structure ;
3. reconnaître les formats bénins exacts ;
4. ajouter le contexte ;
5. utiliser l’entropie seulement sur un candidat ;
6. appliquer la politique.

Un filtre générique ne supprime jamais une signature critique. Seule la valeur
exacte d’un placeholder ou d’un exemple public compilé est exemptée ; la présence
du mot `example` dans le chemin ou le texte voisin n’allège aucun score.

### 10.2 Classes bénignes

| Classe           | Validation                                                                              |
| ---------------- | --------------------------------------------------------------------------------------- |
| UUID             | variantes et longueurs normalisées                                                      |
| SHA/hash hex     | longueurs exactes 32, 40, 64, 96 ou 128                                                 |
| SRI              | forme `sha256`/`sha384`/`sha512` suivie de Base64                                       |
| Lockfile         | aucun parseur ; seules les formes hash/SRI génériques sont filtrées                     |
| Public ID        | préfixe explicitement classé public                                                     |
| Placeholder      | valeur exacte dans une liste versionnée, pas simple sous-chaîne                         |
| Fixture          | aucune exemption par fichier/source ; seuls les exemples exacts compilés sont autorisés |
| Séquence répétée | faible diversité, motif répétitif, jamais seule exemption d’une signature forte         |

### 10.3 Allowlist V0

Le V0 autorise uniquement :

- **envoyer quand même** un WARN brut dans le participant possédé, après
  confirmation explicite pour cette requête ;
- `warn=allow` comme option technique globale du hook, explicitement hors du mode
  protégé parce qu’elle ne demande pas de confirmation par requête.

Le V0 refuse :

- bypass ponctuel de CRITICAL ;
- wildcard global secret/* ;
- stockage de la valeur brute ;
- SHA-256 non salé de la valeur ;
- exception silencieuse créée par le dépôt ;
- exception sans motif dans un mode géré.

Aucune suppression de règle, exception persistante, allowlist utilisateur ou HMAC
n’est implémenté. Ces fonctions sont reportées.

## 11. Politique de panne

| Panne                                       | Surface possédée        | Hook natif                                           |
| ------------------------------------------- | ----------------------- | ---------------------------------------------------- |
| Argument core invalide ou exception interne | BLOCK, `complete:false` | `scan`: exit 2 ; `hook`: exit 2, stdout vide         |
| Entrée core > 1 MiB                         | BLOCK, `complete:false` | `scan`: exit 2 ; `hook`: exit 2, stdout vide         |
| Plafond de findings dépassé                 | BLOCK, `complete:false` | `scan`: exit 2 ; `hook`: exit 2, stdout vide         |
| JSON hook invalide/prompt absent            | N/A                     | exit 2, stdout vide, raison non sensible sur stderr  |
| Erreur d’usage CLI                          | N/A                     | exit 64                                              |
| CLI introuvable, crash ou stdout impossible | N/A                     | aucune garantie ; dépend de VS Code Preview          |
| Timeout/ignorance/préemption hôte           | N/A                     | aucune garantie ; le canari local ne les détecte pas |

Dans le participant possédé, une exception du scanner donne un résultat incomplet
et aucun envoi. Cette propriété ne s’étend pas au hook Preview si VS Code ne lance
pas le processus ou ignore sa réponse.

## 12. Confidentialité mémoire

JavaScript ne garantit pas l’effacement cryptographique des strings immuables. Le V0 ne promet donc pas un zeroization parfait.

Mesures réalistes :

- portée lexicale courte ;
- aucune cache du texte ;
- buffers stdin bornés et libérés ;
- pas de heap dump automatique ;
- crash reporting désactivé ou nettoyé pour les processus du scanner ;
- copies minimisées lors de normalisation ;
- worker/processus terminé après usage lorsque pertinent ;
- documentation explicite de cette limite.

Un attaquant capable de lire la mémoire du processus est hors objectif V0.

## 13. Audit et télémétrie

Le V0 n’émet ni événement d’audit ni télémétrie. La liste suivante est une
allowlist de conception pour une version future, avec opt-in pour tout export :

- timestamp arrondi ;
- surface et version ;
- action ;
- catégories de règles ;
- nombre de findings par bucket ;
- taille et latence par bucket ;
- état du hook ;
- code d’erreur.

### Interdit

- prompt, secret, redaction complète ;
- chemin de fichier ou URL contenant une valeur ;
- offsets précis exportés ;
- nom de variable utilisateur ;
- transcript_path, session_id fournisseur ou cwd ;
- hash simple du secret ;
- stack trace avec données d’entrée.

Aucun schéma d’événement n’est présent dans le build V0. Avant d’ajouter cette
capacité, une allowlist de champs et des snapshots négatifs devront bloquer tout
champ non déclaré.

## 14. Tests de sécurité requis avant certification

La suite livrée couvre les chemins nominaux et hostiles du core, les presenters,
le dispatch, le gestionnaire de hook, un smoke d’activation VS Code, 1 150 cas
positifs synthétiques, 50 000 négatifs générés et un smoke fuzz déterministe de
100 000 entrées. La matrice ci-dessous est plus large : les cas déjà automatisés
n’en valident qu’un sous-ensemble et ne constituent pas une certification.

Le run de régression passant observe zéro faux rejet parmi les 50 000 négatifs et
affiche une borne supérieure de Wilson à 95 % de 0,008 %. Cela borne seulement le
taux sur les familles synthétiques générées ; ce n’est pas une estimation du taux
terrain. Un corpus réel/licencié, dédupliqué et annoté indépendamment reste requis
avant GA ou enterprise.

### 14.1 Table de vérité

- chaque format supporté : positif canonique, mutations valides et invalides ;
- password faible contextualisé ;
- secret sans contexte et contexte sans secret ;
- plusieurs secrets et chevauchements ;
- redaction puis rescan `complete:true`, ALLOW et sans finding ;
- tous les formats bénins listés.

### 14.2 Adversarial

- zero-width inséré à chaque position d’un token synthétique ;
- NFKC, bidi et homoglyphes raisonnables ;
- Base64 et percent-encoding à un niveau ;
- token coupé par CRLF, espaces et indentation ;
- JSON échappé ;
- prompt de 1 MiB moins un octet, exactement 1 MiB, puis plus un octet ;
- 10 000 quasi-candidats ;
- regex fuzzing et property-based tests ;
- payload JSON tronqué, dupliqué, type-confus ou avec champs géants.

### 14.3 Non-divulgation

Injecter un canari unique synthétique, puis rechercher son texte exact dans :

- stdout/stderr capturés ;
- logs et audit ;
- erreurs et stack traces ;
- télémétrie mockée ;
- fichiers temporaires ;
- snapshots ;
- requêtes du faux provider.

Le test réussit seulement si le canari n’apparaît nulle part et si le faux provider a reçu zéro requête.

### 14.4 Intégration VS Code

Pour chaque OS et mode local/remote que la release déclarera supporté :

1. prompt sain : passe ;
2. secret synthétique : bloque ;
3. core en exception : bloque localement ;
4. runtime ou runner absent : aucun état protégé ;
5. input > 1 MiB : bloque ;
6. hook désactivé, préempté ou non approuvé : état exact ;
7. timeout forcé : comportement documenté et test de non-surpromesse ;
8. canari CLI positif/négatif puis preuve séparée que l’hôte a effectivement
   invoqué le hook.

Claude Code et Codex nécessiteront chacun leur propre matrice dans une phase
future ; ils ne font pas partie du gate V0 VS Code.

## 15. Gates de sécurité avant une release certifiée

Une release présentée comme contrôle de sécurité certifié est bloquée si l’un des
critères suivants échoue. Le prototype V0 livré ne satisfait pas encore tous ces
points :

- zéro secret brut dans les canaux observables testés ;
- zéro requête provider après un finding HIGH/CRITICAL ou une erreur ;
- 100 % des entrées > 1 MiB bloquées, sans scan partiel ;
- 100 % des private keys PEM et formats explicitement supportés bloqués dans le corpus synthétique ;
- aucune croissance superlinéaire observée dans une campagne de performance
  définie ; le smoke fuzz actuel ne mesure pas cette propriété ;
- zéro faux BLOCK sur la suite bénigne obligatoire ;
- redaction idempotente et rescan final ALLOW, complet et sans finding ;
- VSIX/CLI/ruleset assortis d’un SBOM, de checksums publiés et d’une provenance —
  non livré actuellement ; l’inspection locale affiche seulement le SHA-256 du
  VSIX construit et compare certains fichiers au workspace ;
- état de couverture exact quand un hook est absent, désactivé, non fiable ou distant — non livré actuellement ;
- revue manuelle de la liste des champs de logs/télémétrie.

Les objectifs de précision/rappel globaux sont définis dans [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md), mais ces invariants de sécurité ne sont pas moyennés.

## 16. Risques acceptés au V0

- un utilisateur peut choisir une surface non protégée ;
- une extension tierce peut émettre son propre trafic ;
- un agent peut lire plus tard un fichier que UserPromptSubmit n’a pas reçu ;
- les pièces jointes natives tierces ne sont pas couvertes ;
- un secret doublement encodé, chiffré ou reconstruit par code peut passer ;
- un administrateur local ou malware peut désactiver/modifier le produit ;
- le hook VS Code Preview peut être ignoré, préempté, expirer ou ne pas être
  exécuté sans que son canari local le détecte ;
- Claude Code et Codex ne sont pas couverts ;
- JavaScript ne garantit pas l’effacement cryptographique de la mémoire ;
- une règle inconnue produit un faux négatif jusqu’à mise à jour.

Ces risques doivent figurer dans le README produit et l’écran de couverture.

## 17. Sources primaires

- [VS Code Extension Capabilities](https://code.visualstudio.com/api/extension-capabilities/overview)
- [VS Code Agent Hooks et codes de sortie](https://code.visualstudio.com/docs/agent-customization/hooks#_exit-codes)
- [VS Code Hooks Reference — UserPromptSubmit](https://code.visualstudio.com/docs/agents/reference/hooks-reference#_userpromptsubmit)
- [VS Code Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust)
- [Claude Code Hooks — UserPromptSubmit, block et timeout](https://code.claude.com/docs/en/hooks#userpromptsubmit)
- [Claude Code Hook locations et politiques gérées](https://code.claude.com/docs/en/hooks#hook-locations)
- [Codex Hooks — confiance, erreurs MCP et UserPromptSubmit](https://learn.chatgpt.com/fr-FR/docs/hooks)
- [Codex configuration — couches partagées CLI/IDE](https://learn.chatgpt.com/fr-FR/docs/config-file/config-basic)
- [MITRE CWE-532 — Sensitive Information in Log File](https://cwe.mitre.org/data/definitions/532.html)
- [MITRE CWE-400 — Uncontrolled Resource Consumption](https://cwe.mitre.org/data/definitions/400.html)
- [Unicode UAX #15 — Normalization Forms](https://unicode.org/reports/tr15/)
- [Unicode TR #36 — Security Considerations](https://unicode.org/reports/tr36/)
