# Secret Guard — Architecture de référence

**Statut :** photographie de l’implémentation V0.2 livrée et trajectoire future

**Référence :** SG-ADR-001

**Date de vérification des API :** 11 septembre 2026

**Cible V0.2 :** VS Code 1.136 ou plus récent ; Node.js 22.13 ou plus récent pour le workspace et le CLI autonome

Les paragraphes marqués **Futur** décrivent une direction et non une capacité
livrée. Les intégrations utilisateur sont testées au niveau de leur contrat de
processus ; elles ne constituent pas une attestation d’exécution hôte ni un
déploiement administrateur non contournable.

## 1. Décision

Secret Guard V0.2 est composé de trois artefacts :

1. **secret-guard-core** : bibliothèque TypeScript locale, déterministe et indépendante de VS Code ;
2. **secret-guard-cli** : scanner Node.js et processus de hook qui lit un
   événement JSON sur stdin, autorise par JSON/exit 0 et refuse par exit 2 sans
   valeur détectée ;
3. **secret-guard-vscode** : extension VS Code avec un installateur
   transactionnel des hooks utilisateur VS Code/Copilot, Claude Code, Codex et
   Windsurf, un cadenas d’état, le participant de diagnostic `@secretguard` et
   trois commandes de scan.

Le V0 n’embarque **aucun modèle ML ou SLM**. Le moteur combine des signatures
structurées, un parseur textuel d’affectations, une entropie bornée par token, des
validateurs et une politique explicable. Son catalogue de RegExp JavaScript est
statique et aucune regex utilisateur ou téléchargée n’est évaluée. La suite
actuelle comprend des cas hostiles ciblés et un smoke fuzz déterministe de
100 000 entrées, pas une certification fuzz exhaustive ni une preuve de
complexité de toutes les expressions.

Le produit ne revendique pas une interception universelle. La garantie est annoncée **surface par surface** :

- blocage automatique du champ prompt documenté sur les quatre hôtes configurés ;
- contrôle d’intégrité du runner, fusion non destructive des configurations et
  canaris locaux sur les deux enveloppes de protocole, sans preuve que l’hôte a
  chargé ou exécuté le hook ;
- provider ou gateway contrôlé reporté à une phase future ;
- aucune garantie pour une vue tierce sans hook ni intégration officielle.

Dans le participant possédé, un WARN non expurgé nécessite une confirmation
explicite pour cette requête. Une version expurgée ne peut être qualifiée de sûre à
l’envoi que si le rescan exact retourne `complete:true` et `ALLOW`. Le dispatch
refuse un rescan incomplet, WARN ou BLOCK.

Cette séparation est un invariant produit, pas un détail d’implémentation.

## 2. Les hypothèses initiales à écarter

### 2.1 Le cadenas superposé au bouton Envoyer

Un overlay posé sur le bouton de Copilot, Claude ou Codex serait une fausse bonne idée :

- une extension standard n’a pas accès au DOM de VS Code et ne peut pas injecter un élément dans l’interface native ;
- les sélecteurs, coordonnées, commandes internes et arbres d’accessibilité ne sont pas des contrats publics ;
- le bouton, le raccourci clavier, les commandes slash et les modes Agent peuvent emprunter des chemins différents ;
- une mise à jour de VS Code ou de l’assistant casserait silencieusement la protection.

La restriction DOM est explicite dans la documentation officielle des [capacités d’extension VS Code](https://code.visualstudio.com/api/extension-capabilities/overview). Le cadenas devient donc un **indicateur d’état** dans la barre de statut ou dans la vue Secret Guard, jamais une preuve qu’un bouton tiers a été verrouillé.

### 2.2 Une extension peut intercepter toutes les commandes

L’API stable permet d’enregistrer et d’exécuter des commandes, mais ne fournit pas de middleware global avant l’exécution des commandes d’autres extensions. Les commandes privées ou non documentées ne sont pas une frontière de sécurité ; voir la [référence des commandes VS Code](https://code.visualstudio.com/api/references/vscode-api#commands).

Sont donc refusés :

- monkey-patch du gestionnaire Envoyer ;
- keybinding qui prétend couvrir toutes les autres voies d’envoi ;
- lecture a posteriori d’un transcript ou d’un stockage interne ;
- automatisation de l’UI ou écoute globale du clavier/presse-papiers.

### 2.3 Un SLM améliore nécessairement la détection

Au V0, un modèle ajouterait taille, démarrage, supply chain, opacité et faux négatifs sans améliorer les formats fortement structurés. Un modèle ne doit jamais pouvoir neutraliser une signature critique. La phase ML est un gate expérimental ultérieur, déclenché uniquement par un corpus mesuré d’erreurs résiduelles.

### 2.4 Scanner le texte tapé protège tout le contexte envoyé

Faux. Un hook UserPromptSubmit voit le champ prompt documenté, pas nécessairement :

- le contenu résolu d’une pièce jointe ;
- les fichiers lus ensuite par l’agent ;
- les sorties d’outils ;
- le contexte ajouté par une autre extension ;
- les instructions système ou le transcript complet ;
- une requête émise hors de l’hôte protégé.

Secret Guard V0 est un **garde du prompt utilisateur**, pas encore un DLP complet de l’agent. La couverture des pièces jointes et de l’egress complet nécessite une intégration provider/gateway ou des hooks d’outils complémentaires.

## 3. Périmètre exact du V0

### Inclus

- champ texte du prompt fourni aux hooks natifs configurés ;
- texte du presse-papiers uniquement après une commande explicite ;
- contenu de sélection ou de fichier explicitement demandé à Secret Guard ;
- texte .env, .txt, .md et snippets de code lorsqu’il entre par l’un de ces chemins ;
- installateur utilisateur pour VS Code/Copilot `UserPromptSubmit`, Claude Code
  `UserPromptSubmit`, Codex `UserPromptSubmit` et Windsurf `pre_user_prompt` ;
- détection locale des mots de passe, tokens, JWT, clés privées, URL de base de données, credentials cloud et secrets génériques contextualisés ;
- proposition de redaction dans l’interface possédée par Secret Guard ;
- sorties de scan sans valeur ni extrait du secret.

### Exclus

- interception garantie de toute webview ou extension d’assistant ;
- contenu binaire et pièces jointes transitant directement dans une UI tierce ;
- PDF, OCR, image ou archive ;
- scan automatique du dépôt avant chaque action ;
- lecture globale ou surveillance continue du presse-papiers ;
- validation réseau d’un secret auprès de son fournisseur ;
- protection d’un poste compromis ou d’un secret déjà envoyé ;
- apprentissage sur des données utilisateur.
- attestation de chargement hôte, déploiement système/MDM ou résistance à root ;
- audit, télémétrie, allowlist persistante ou règles administrateur.

Dans V0, « prise en charge de .env/.md/source » signifie **scan de leur texte via une commande possédée par Secret Guard**. Cela ne signifie pas interception des pièces jointes natives d’un assistant. Cette dernière capacité appartient à V1.

Le catalogue compilé reconnaît actuellement : GitHub PAT classiques et
fine-grained, GitLab, OpenAI, Anthropic, OpenRouter, Stripe secret/restricted,
Slack tokens/webhooks, Google API et OAuth `ya29`, SendGrid, npm, Hugging Face,
Databricks, DigitalOcean, Shopify, Azure `AccountKey`, AWS access-key ID isolé
(WARN), JWT structurels, blocs PEM privés, URL avec user/password, affectations à
noms sensibles, credentials de cookies de session, arguments basic-auth CLI,
champs Docker `auth` Base64 et tokens de forte entropie (WARN). « Cloud
credentials » ne doit pas être interprété comme une couverture AWS/Azure/GCP
exhaustive ; aucune règle GCP dédiée n’est livrée.

## 4. Frontières d’interception

| Surface                                          | Ce qu’une extension standard voit            | Intégration robuste                       | Garantie honnête                                                                       |
| ------------------------------------------------ | -------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Participant de chat Secret Guard                 | Requête adressée à `@secretguard`            | Chat Participant API                      | Routage contrôlé pour cette requête uniquement ; rescan redacted obligatoirement ALLOW |
| Commandes scan sélection/document/presse-papiers | Texte explicitement lu                       | Commandes VS Code                         | Scan local seulement ; aucune interception d’un envoi tiers                            |
| VS Code Agent / Copilot compatible               | Champ `prompt` de `UserPromptSubmit`         | Fichier de hook + runner local            | Livré, Preview, non attesté côté hôte                                                  |
| Claude Code CLI et extension IDE                 | Champ `prompt` de `UserPromptSubmit`         | Fusion dans `~/.claude/settings.json`     | Livré au niveau contrat utilisateur, non attesté côté hôte                             |
| Codex CLI et extension IDE                       | Champ `prompt` de `UserPromptSubmit`         | Fusion dans `~/.codex/hooks.json`         | Livré au niveau contrat utilisateur, confiance hôte encore requise                     |
| Windsurf Cascade                                 | `tool_info.user_prompt` de `pre_user_prompt` | Fusion dans le hooks utilisateur          | Livré au niveau contrat utilisateur ; exit 2 bloque selon la documentation             |
| Modèle ou gateway fourni par Secret Guard        | Non livré                                    | Provider/gateway futur                    | Hors V0                                                                                |
| Assistant tiers sans hook                        | Rien de garanti                              | Accord d’intégration du fournisseur       | Aucune                                                                                 |
| Agent lisant un fichier ensuite                  | Pas couvert par UserPromptSubmit             | Hook PreToolUse ou gateway d’egress futur | Hors V0                                                                                |

### 4.1 VS Code UserPromptSubmit : utile mais Preview

Les [Agent Hooks de VS Code](https://code.visualstudio.com/docs/agent-customization/hooks) sont marqués **Preview**. VS Code transmet l’événement sur stdin et reçoit du JSON sur stdout. Les fichiers peuvent être recherchés notamment dans .github/hooks, .claude/settings.json ou les emplacements utilisateur documentés. En environnement Remote, SSH, WSL ou Container, la commande s’exécute sur la plateforme de l’Extension Host, qui peut différer du poste local.

La [référence UserPromptSubmit](https://code.visualstudio.com/docs/agents/reference/hooks-reference#_userpromptsubmit) précise :

- le hook reçoit le champ prompt ;
- il n’offre que le format de sortie commun ;
- le code 2 bloque ;
- le code 0 analyse stdout comme JSON ;
- un autre code est un avertissement non bloquant et le traitement continue ;
- le délai par défaut est de 30 secondes.

Conséquences :

- le runner livré sort avec le code `2`, laisse stdout vide et écrit une raison
  non sensible sur stderr pour WARN/BLOCK/entrée invalide ; ALLOW sort avec le
  code `0` et `{ "continue": true }` sur stdout ;
- il ne tente pas de réécrire le prompt, car aucun champ de remplacement n’est documenté pour UserPromptSubmit ;
- un résultat WARN devient BLOCK par défaut sur cette surface, faute de protocole de confirmation avant envoi ;
- l’option technique `warn=allow` est un opt-in qui affaiblit la protection et ne
  constitue pas une confirmation par requête ;
- des tests de contrat subprocess vérifient ces sorties, mais un test
  d’interception par l’hôte reste requis avant certification ;
- l’extension contrôle le runner par canaris locaux. Elle n’exécute pas de canari
  traversant réellement le pipeline de prompt de VS Code.

Une API proposée ne doit pas être publiée telle quelle sur Marketplace : VS Code réserve l’usage des proposed APIs aux builds Insiders et au développement, selon [Using Proposed API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api). Secret Guard ne dépend donc pas d’une API d’extension proposée ; il installe, à la demande de l’utilisateur, un fichier de configuration du mécanisme de hooks Preview. Cette écriture ne valide ni le chargement du hook ni sa priorité face aux réglages workspace ou aux politiques administrateur.

### 4.2 Participant de chat : fallback coopératif

La [Chat Participant API](https://code.visualstudio.com/api/extension-guides/ai/chat) permet de traiter une requête adressée au participant enregistré. Elle fournit une excellente UX de fallback, par exemple @secretguard, mais ne reçoit pas les prompts adressés à @workspace ou à une autre extension.

Le participant :

1. scanne le prompt ;
2. affiche les catégories et positions sans valeur brute ;
3. autorise une redaction locale ;
4. transmet un prompt ALLOW, ou un WARN brut confirmé explicitement par
   l’utilisateur. Une version redacted n’est transmise qu’après un rescan complet
   retournant ALLOW.

Il n’est pas présenté comme un intercepteur global.

### 4.3 Claude Code — hook utilisateur livré, hôte non attesté

Le [hook UserPromptSubmit de Claude Code](https://code.claude.com/docs/en/hooks#userpromptsubmit) s’exécute avant traitement, reçoit prompt et peut répondre avec decision: block. Depuis la documentation vérifiée :

- un blocage efface le prompt du contexte ;
- le hook ne propose pas de champ de réécriture du prompt ;
- command, HTTP et mcp_tool ont un timeout UserPromptSubmit de 30 secondes ;
- leur timeout laisse néanmoins le prompt atteindre Claude ;
- seul un callback Agent SDK expiré est fail-closed depuis Claude Code 2.1.208.

Le V0.2 fusionne une entrée marquée dans la configuration utilisateur, sans
écraser les hooks existants, et teste ALLOW/BLOCK sur le runner. L’exécution par
l’hôte et le déploiement géré restent à attester séparément.

L’extension VS Code de Claude partage la configuration dans ~/.claude/settings.json avec la CLI, selon la documentation des [intégrations IDE Claude Code](https://code.claude.com/docs/en/ide-integrations). La distribution robuste passe par :

- configuration personnelle ou projet pour le pilote ;
- plugin Claude avec hooks/hooks.json pour le packaging ;
- réglages gérés et allowManagedHooksOnly pour l’entreprise.

Les [emplacements et règles des hooks Claude](https://code.claude.com/docs/en/hooks#hook-locations) restent l’autorité. Une extension VS Code générique ne modifie jamais silencieusement ces réglages.

### 4.4 Codex — hook utilisateur livré, hôte non attesté

La documentation officielle [Hooks Codex](https://learn.chatgpt.com/fr-FR/docs/hooks) cite explicitement l’analyse des prompts pour bloquer des clés API. UserPromptSubmit reçoit le prompt sur stdin et accepte decision: block ou le code de sortie 2.

Les [principes de configuration Codex](https://learn.chatgpt.com/fr-FR/docs/config-file/config-basic) indiquent au 11 septembre 2026 :

- la feature hooks est **Stable** et activée par défaut ;
- la CLI et l’extension IDE partagent les mêmes couches de configuration ;
- les hooks non gérés doivent être examinés et déclarés fiables ;
- un hook projet est ignoré dans un projet non fiable ;
- requirements.toml peut imposer des hooks gérés et allow_managed_hooks_only.

Le V0.2 fusionne une entrée marquée dans `~/.codex/hooks.json` et teste le contrat
ALLOW/exit 2. Codex exige encore la confiance explicite pour les hooks non gérés.
Un futur gate devra aussi
prouver que Workspace Trust et les politiques actives n’ont pas préempté le hook.

### 4.5 Provider ou proxy : la seule couverture complète d’un chemin choisi

La [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider) permet d’enregistrer ses propres modèles. Le provider reçoit le tableau de messages et contrôle l’appel réseau. Cette route fournit une frontière d’egress robuste, mais seulement lorsque l’utilisateur sélectionne ce provider. Pour Copilot Business/Enterprise, l’administrateur peut désactiver la politique Bring Your Own Language Model Key.

Le gateway explicite est la trajectoire enterprise :

- le client scanne localement pour une réponse immédiate ;
- le gateway réapplique une politique serveur sur le trafic qui lui est routé ;
- l’organisation contrôle le provider, la résidence, la rétention et l’audit ;
- aucun MITM TLS transparent n’est requis.

Le proxy FastAPI existant de ce dépôt pourra consommer le même ruleset et les mêmes vecteurs de contrat, mais il ne remplace pas le noyau TypeScript du chemin interactif V0.

### 4.6 Ce qui est fragile ou impossible

Ne pas implémenter :

- overlay DOM ou CSS sur le bouton d’une autre extension ;
- interception universelle des commandes ou du raccourci Entrée ;
- lecture globale du presse-papiers ;
- scraping de webview, transcript ou base interne ;
- outil MCP ou Language Model Tool supposé agir comme middleware : le modèle peut recevoir le prompt avant de choisir l’outil ;
- proxy réseau transparent du poste : TLS, Remote Development, certificats, providers et clients hors VS Code rendent la garantie incomplète ;
- badge « protégé » déduit de la simple présence de l’extension.

## 5. Architecture logique

```text
┌──────────────────────────────────────────────────────────────────┐
│ Surfaces V0                                                      │
│ @secretguard │ scans explicites │ hook VS Code Preview configuré │
└───────────────┬──────────────────────────────────────────────────┘
                │ texte en mémoire / JSON stdin borné
                ▼
┌──────────────────────── secret-guard-core ───────────────────────┐
│ 1. garde de taille                                                │
│ 2. vues normalisées + mapping vers offsets originaux             │
│ 3. parseurs de contexte                                          │
│ 4. détecteurs structurés statiques                               │
│ 5. validateurs + entropie ciblée + filtres de faux positifs      │
│ 6. consolidation des findings                                    │
│ 7. risk policy                                                   │
│ 8. redactor                                                      │
└───────────────┬──────────────────────────────────────────────────┘
                │ ScanResult sans contenu brut
        ┌───────┴───────────────┐
        ▼                       ▼
 secret-guard-cli       secret-guard-vscode
 scan / JSON hook       UX et état de configuration
        │                       │
        └───────────┬───────────┘
                    ▼
             envoi explicitement autorisé
```

## 6. Noyau TypeScript

### 6.1 Contraintes

secret-guard-core :

- ne dépend pas de vscode ;
- n’effectue aucun appel réseau ;
- ne lit ni n’écrit aucun fichier ;
- n’utilise aucun journal global ;
- ne conserve aucun prompt entre deux appels ;
- produit des résultats déterministes pour un ruleset donné ;
- borne la taille d’entrée, chaque décodage Base64 et le nombre de findings ;
- refuse toute entrée supérieure à **1 MiB UTF-8** sans scan partiel.

Le seuil est mesuré en octets UTF-8, pas en nombre de caractères JavaScript.
Les limites implémentées sont : 16 384 octets de sortie par opération Base64,
128 tentatives de décodage et 262 144 octets de sortie estimés et budgétés pour
l’ensemble du scan (candidats génériques, segments JWT et auth Docker), 128
fenêtres de jointure de 16 384 caractères au plus, et 2 048
findings avant échec fermé. Un bloc PEM complet couvre de son en-tête au footer
correspondant dans l’entrée bornée à 1 MiB ; un en-tête sans footer couvre
jusqu’à la fin. Il n’existe pas de budget wall-clock distinct.

### 6.2 Contrats

```ts
type SourceKind = "prompt" | "clipboard" | "selection" | "document" | "text";

interface ScanInput {
  content: string;
  sourceKind?: SourceKind;
  languageId?: string;
}

type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type Decision = "ALLOW" | "WARN" | "BLOCK";

interface Finding {
  ruleId: string;
  secretType: string;
  span: {
    start: { offset: number; line: number; column: number };
    end: { offset: number; line: number; column: number };
  };
  score: number;
  level: RiskLevel;
  reasons: string[];
  encoding:
    | "plain"
    | "normalized"
    | "percent"
    | "json-escaped"
    | "base64"
    | "whitespace-joined";
}

interface ScanResult {
  decision: Decision;
  level: RiskLevel;
  score: number;
  findings: Finding[];
  complete: boolean;
  inputBytes: number;
  rulesetVersion: string;
}
```

ScanResult ne contient ni la valeur, ni le prompt, ni un extrait. `complete:false`
signifie que le consommateur doit bloquer ; les erreurs de limite et de scanner
sont représentées par des findings synthétiques non sensibles. L’UI calcule une
redaction en mémoire à partir des offsets. JavaScript ne permet pas de promettre
l’effacement cryptographique des chaînes. Le V0 ne collecte ni durée ni
télémétrie.

### 6.3 Pipeline

1. **Garde d’entrée**
   - validation du type ;
   - calcul UTF-8 ;
   - blocage au-dessus de 1 MiB ;
   - plafond de findings à 2 048 ; dépassement traité comme échec fermé.

2. **Normalisation avec traçabilité**
   - texte original conservé uniquement pendant l’appel ;
   - vue NFKC ;
   - suppression des points de code ayant la propriété Unicode
     `Default_Ignorable_Code_Point`, ce qui couvre notamment les caractères
     zero-width, marques de variation et contrôles bidi ;
   - mapping de chaque offset normalisé vers la plage originale ;
   - aucune normalisation destructive avant création du mapping.

3. **Décodage borné**
   - un passage percent-encoding UTF-8 strict et un passage JSON Unicode/slash,
     composables dans les deux ordres puis renormalisés ; les séquences percent
     invalides restent littérales et Base64 ne récursive jamais ;
   - seulement pour un candidat de taille et de contexte plausibles ;
   - Base64 limité à 16 384 octets de sortie par opération, 128 tentatives et
     262 144 octets de sortie estimés cumulés globalement ;
   - jointure multiligne limitée à 128 fenêtres candidates de 16 384 caractères ;
   - aucune décompression ni récursion au V0.

4. **Parseurs de contexte**
   - affectations .env et shell ;
   - affectations textuelles de forme clé/valeur utilisables dans `.env`, shell,
     JSON, YAML, TOML et snippets simples ; il ne s’agit pas de parseurs complets ;
   - vue supplémentaire décodant un niveau d’échappements JSON `\\uXXXX` et
     `\/` ;
   - URL avec userinfo ;
   - blocs PEM ;
   - noms de variables et voisinage.

5. **Détecteurs**
   - formats fournisseurs à préfixe fort ;
   - credentials composites ;
   - JWT et clés privées ;
   - password/secret/token générique sous contexte ;
   - entropie sur des tokens candidats de 20 à 512 caractères.

6. **Validation et suppression des faux positifs**
   - alphabet, longueur ou structure attendue ;
   - formes UUID, longueurs de hash hex, SRI, ULID et quelques préfixes d’ID
     publics ; aucun parseur de lockfile complet ;
   - placeholders et exemples documentés ;
   - `sourceKind` et un contexte test/fixture n’allègent aucun score ; pour une
     liste fermée de `languageId` de code, une valeur d’affectation non quotée et
     non numérique est traitée comme expression/référence plutôt que comme
     littéral. Les signatures fixes restent actives.

7. **Consolidation**
   - suppression des chevauchements en conservant le finding le plus spécifique ;
   - le détecteur spécifique prime pour la classification et fournit les
     reasonCodes conservés ; sa plage est élargie pour couvrir tout finding
     contextuel chevauchant.

8. **Politique**
   - score d’évidence reproductible, versionné ;
   - décision séparée de la détection ;
   - union des plages valides chevauchantes ou adjacentes, puis redaction de droite
     à gauche ; `redactAndRescan` ne retourne le texte expurgé que si le scan
     initial est complet et le verdict final complet vaut ALLOW. Sinon son champ
     `content` est une chaîne vide.

### 6.4 Expressions régulières et ReDoS

Le V0 utilise uniquement un petit ensemble de RegExp JavaScript écrites avec des
longueurs maximales explicites, sans pattern fourni à l’exécution. Les tests
actuels couvrent trois charges hostiles bornées chacune à deux secondes et un smoke fuzz
déterministe de 100 000 entrées. Ce smoke ne mesure pas systématiquement la
croissance et ne constitue ni une campagne coverage-guided ni une preuve générale
d’absence de comportement superlinéaire. Toute extension du catalogue doit
ajouter des cas et budgets ciblés avant release.

Avant d’accepter des règles personnalisées, la Phase 1 benchmarke [google/re2-wasm](https://github.com/google/re2-wasm), sous licence Apache-2.0. RE2 refuse les constructions de backtracking problématiques, mais impose un binaire Wasm, un coût d’initialisation, un SBOM/checksum et ne prend pas en charge lookahead/backreferences. La décision d’embarquer RE2-Wasm doit être consignée dans un ADR avec mesures. En attendant, **aucune regex dynamique n’est autorisée**.

## 7. Risk engine

Le score 0–100 représente une **force d’évidence**, pas une probabilité statistique. L’interface affiche « faible/moyenne/élevée/critique », et non « 99,8 % », tant qu’aucune calibration ne justifie ce chiffre.

Le score retourné est un score fixe par règle, éventuellement minoré de cinq
points après percent/Base64/échappement JSON/jointure de lignes. Les principaux
scores livrés sont :

| Famille                                                           |                 Score de base |
| ----------------------------------------------------------------- | ----------------------------: |
| Clé privée PEM complète                                           |                           100 |
| Token fournisseur fort, URL DB avec credentials, Azure AccountKey |                            95 |
| Clé OpenAI                                                        |                            92 |
| Google API key, basic-auth URL, PEM incomplet                     |                            90 |
| Affectation à nom sensible                                        | 70, ou 75 si forme entropique |
| JWT structurel                                                    |                            60 |
| AWS access-key ID isolé                                           |                            45 |
| Entropie seule                                                    |                            35 |

Le résultat global prend le score maximal ; les findings ne s’additionnent pas.
Les placeholders/exemples exacts et formes bénignes reconnues sont supprimés avant
scoring plutôt que pondérés négativement.

| Niveau   | Règle initiale                   | Action UI possédée                                                   | Action hook natif                                     |
| -------- | -------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| LOW      | score inférieur à 25             | ALLOW                                                                | ALLOW                                                 |
| MEDIUM   | 25–49                            | WARN ; envoi brut seulement après confirmation explicite par requête | BLOCK par défaut ; `warn=allow` est hors mode protégé |
| HIGH     | 50–74                            | BLOCK, redaction proposée                                            | BLOCK                                                 |
| CRITICAL | 75–100 ou règle à blocage absolu | BLOCK sans bypass ponctuel                                           | BLOCK                                                 |

Une clé privée PEM, un token fournisseur complet ou une URL contenant user et password est au minimum HIGH. L’entropie seule ne dépasse jamais MEDIUM.

## 8. Pont CLI et adaptateurs de hooks

### 8.1 Transport

`secret-guard-cli` :

- lit exactement un objet JSON depuis stdin ;
- limite le flux à 1 MiB plus une enveloppe JSON bornée ;
- n’accepte jamais le prompt en argument, variable d’environnement ou fichier temporaire ;
- écrit le JSON ALLOW sur stdout ; un refus laisse stdout vide et écrit seulement
  une raison non sensible sur stderr ;
- garde stdout/stderr sans valeur détectée dans ses réponses normales ;
- termine ses flux après décision. Les buffers deviennent éligibles au garbage
  collector, sans garantie de zeroization.

### 8.2 Sémantique commune

```text
secret-guard scan + ALLOW -> exit 0
secret-guard scan + WARN  -> exit 1
secret-guard scan + BLOCK -> exit 2
erreur d’usage scan        -> exit 64
hook ALLOW                 -> exit 0 + JSON { continue: true } sur stdout
hook WARN/BLOCK/erreur     -> exit 2 + stdout vide + raison sur stderr
```

La fonction interne de contrat représente un refus par `continue:false` et
`stopReason`, sans valeur détectée. Le processus ne sérialise pas cet objet en cas
de refus : le code `2` porte la décision de blocage conformément au contrat VS
Code Preview, Claude Code et Codex. Les canaris valident localement les deux
enveloppes acceptées par le runner ; ils n’attestent toutefois pas que chaque
hôte charge et invoque effectivement sa configuration.

Un crash avant que le runtime Node ne produise une sortie ne peut pas être
transformé en blocage par le programme lui-même. Les canaris locaux peuvent
signaler un runner cassé au moment du contrôle ; ils ne voient pas un hook que
l’hôte ignore ou préempte et ne constituent donc pas une attestation.

Les messages utilisateur ne contiennent que type, ligne/colonne, règle et action. Jamais la valeur.

### 8.3 Timeout : limite non masquable

Le fail-closed interne ne permet pas de promettre le fail-closed de l’hôte :

- l’hôte peut ignorer un hook, son erreur ou son timeout selon son propre contrat ;
- Workspace Trust, les réglages workspace et les politiques administrateur
  peuvent préempter le fichier utilisateur ;
- VS Code traite les codes autres que 2 comme non bloquants.

Le hook configuré utilise un timeout hôte de **30 secondes**. Le contrôle local
impose 5 secondes par invocation et exécute un prompt sain
puis un secret synthétique ; il vérifie sorties, codes et absence du canari dans
stdout/stderr. Ce contrôle est exécuté à l’activation et lors du calcul de l’état
du hook, mais il ne traverse pas le pipeline de prompt de VS Code. Le statut ne
détecte donc pas l’ignorance ou la préemption du hook par l’hôte. Le mécanisme
Preview reste conditionnel, jamais une garantie universelle.

## 9. Extension VS Code

### 9.1 Contributions

- commandes **Secret Guard: Scanner le presse-papiers**, **Scanner la
  sélection** et **Scanner le document ouvert** ;
- participant **@secretguard**, qui constitue le prompt possédé du V0 ;
- messages modaux et Markdown sans contenu brut ;
- action **Copier la version redacted** ;
- commandes explicites d’installation et de retrait du hook ;
- barre de statut à quatre états fondés sur la configuration gérée, son intégrité
  et le canari local.

### 9.2 États de couverture

```text
actif    : les quatre configurations sont présentes, le runner est intact et les canaris locaux réussissent
partiel  : certains hôtes seulement sont configurés
dégradé  : configuration invalide, runner absent/modifié ou canari local en échec
désactivé: aucune entrée Secret Guard n'est installée
```

« Actif » n’équivaut pas à une attestation PROTECTED. Le chargement par l’hôte, la
confiance, l’ordre des configurations, le Remote Extension Host et la politique
de l’organisation ne sont pas attestés. Un futur état protégé nécessiterait une
preuve hôte de bout en bout ; les deux appels locaux sain/bloquant ne suffisent
pas.

### 9.3 Installation des hooks

L’utilisateur déclenche explicitement la commande d’activation. L’implémentation
copie le hook embarqué, puis fusionne par renommage atomique une entrée marquée
dans les configurations utilisateur VS Code/Copilot, Claude Code, Codex et
Windsurf, avec un mode demandé de `0600`. Elle conserve les réglages et hooks
étrangers. La désactivation retire uniquement les entrées marquées Secret Guard.

L’installation est transactionnelle : une erreur restaure les snapshots pris
avant modification. Elle refuse une configuration qui usurpe le marqueur sans
correspondre à une forme gérée connue. Elle compare le runner installé au bundle
et lance les canaris locaux avant écriture, mais ne détecte pas le lieu réel
d’exécution et ne lance pas de canari hôte. Une configuration workspace ou gérée
peut prendre la priorité sur la configuration utilisateur.

Pour Remote SSH, WSL, Dev Container ou Codespaces, le runtime et le runner copié
doivent exister **là où le hook s’exécute**. L’installateur utilise actuellement
`process.execPath` et le stockage global de l’Extension Host actif, sans attester
que cet emplacement sera celui utilisé pour chaque prompt. La documentation VS
Code confirme cette distinction de plateforme dans [Agent Hooks](https://code.visualstudio.com/docs/agent-customization/hooks#_os-specific-commands).

### 9.4 Distribution

L’extension est empaquetable avec vsce en VSIX et la CI inspecte son contenu.
Elle n’est actuellement ni signée ni publiée. Marketplace et les autres canaux
décrits dans [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
restent des options de distribution futures.

Cette installation couvre les hooks utilisateur VS Code/Copilot, Claude Code,
Codex et Windsurf. Une politique d’entreprise peut bloquer, remplacer ou forcer
des hooks ; un VSIX installé manuellement n’a pas nécessairement l’auto-update
activé et un utilisateur local peut retirer ses propres configurations.

## 10. Confidentialité et observabilité

### Invariants

- aucun prompt ou secret brut dans logs, stdout, stderr, télémétrie, crash report ou fichier temporaire ;
- aucun extrait masqué par défaut : une courte valeur peut rester devinable ;
- aucune empreinte SHA-256 non salée d’un secret de faible entropie ;
- aucune vérification active auprès d’AWS, GitHub, Stripe ou autre fournisseur ;
- aucun identifiant de règle construit depuis la valeur ;
- aucune persistance de findings par défaut.

Le V0 ne produit aucune télémétrie ni événement d’audit. Un futur schéma local ou
opt-in pourrait contenir exclusivement :

```json
{
  "event": "scan_decision",
  "action": "BLOCK",
  "categories": ["github-token"],
  "findingCountBucket": "1",
  "sizeBucket": "4-16KiB",
  "latencyBucket": "10-25ms",
  "rulesetVersion": "2026.09.0",
  "surface": "vscode-owned"
}
```

La corrélation d’une exception persistante, si elle est ajoutée, utilise un HMAC avec une clé locale issue du trousseau/SecretStorage et une expiration. Elle n’est pas nécessaire au V0.

## 11. Performance et budgets

Gates de régression réellement exécutés par `scripts/benchmark.mjs` sur des
prompts ASCII sains, après échauffement :

| Chemin         |                  Taille |                    Objectif |
| -------------- | ----------------------: | --------------------------: |
| core chaud     |  16 KiB, 250 itérations |   p95 ≤ 15 ms ; p99 ≤ 30 ms |
| core chaud     | 256 KiB, 100 itérations |  p95 ≤ 75 ms ; p99 ≤ 125 ms |
| core chaud     |    1 MiB, 30 itérations | p95 ≤ 250 ms ; p99 ≤ 400 ms |
| CLI subprocess |   16 KiB, 20 lancements |                p95 ≤ 350 ms |

Le script affiche p50/p95/p99 pour le core et p95 pour les lancements CLI. Le
libellé « CLI cold start » désigne des subprocess Node successifs sur le même
hôte de CI ; ce n’est pas une mesure d’installation ou de première exécution sur
une machine vierge. La RSS, le CPU, le chemin extension/hôte de bout en bout, les
prompts contenant un secret et les quasi-candidats ne sont pas mesurés. Ces seuils
ne justifient donc pas une promesse de latence universelle.

Trois tests adversariaux séparés exigent moins de 2 secondes chacun pour un
non-match de 1 MiB, une ligne d’alphabet Base64 de 1 MiB et des en-têtes PEM
incomplets denses. Ce sont des bornes de régression sur le runner de test, pas un
SLA ni une preuve de complexité asymptotique.

Le gate de couverture réellement configuré porte sur le core : 90 % lignes,
statements et fonctions, **85 % branches**. Il n’existe pas encore de couverture
instrumentée équivalente pour le CLI et l’extension.

L’évaluation de régression génère 1 150 positifs et 50 000 négatifs synthétiques.
Sur le run passant, aucun faux rejet n’est observé parmi ces 50 000 négatifs ; la
borne supérieure de Wilson à 95 % affichée est 0,008 %. Cette borne décrit
uniquement cet échantillon généré à partir d’un petit nombre de familles. Elle
n’est ni un intervalle populationnel sur les prompts développeurs ni une preuve
terrain de précision/rappel. Un corpus dédupliqué, indépendant et annoté reste un
gate avant GA ou enterprise.

## 12. Rulesets et compatibilité

Le V0 embarque directement les règles TypeScript et expose la constante de version
`2026-09-11.v0`. Il ne charge aucun ruleset externe, ne valide pas de checksum ou
de signature et ne propose pas de règles personnalisées. Il n’existe donc aucun
chemin de téléchargement ou de downgrade de ruleset dans cette version.

Un format séparé, versionné, signé et compatible avec des politiques gérées reste
une évolution future. Toute mention de checksum, signature Ed25519, expiration ou
migration de règles décrit cette cible et non l’artefact livré.

Le moteur Python existant peut fournir des idées de règles et des fixtures après audit. Il ne reste pas une seconde source d’autorité : les règles supportées et leurs tests sont portés vers le format commun, et le chemin interactif est TypeScript.

## 13. Évolution

### V1

- pièces jointes texte avec extraction avant envoi ;
- parseurs streaming pour JSON/YAML/TOML/CSV ;
- PDF texte local avec limite de pages/octets ;
- hooks PreToolUse ciblés pour empêcher la lecture de fichiers sensibles ;
- provider Secret Guard optionnel ;
- exceptions persistantes à portée réduite.

### V2

- OCR local et documents complexes ;
- analyse de dépôt avant délégation ;
- politique sur sorties d’outils et contexte résolu ;
- gateway enterprise ;
- règles gérées, signées et air-gapped ;
- audit central métadonnées-only.

### Enforced mode

Une extension utilisateur ne peut pas s’auto-déclarer non désactivable. L’enforced mode combine :

- Marketplace privé ou MDM pour distribuer les artefacts ;
- politiques VS Code, décrites dans [Enterprise policies](https://code.visualstudio.com/docs/enterprise/policies) ;
- réglages gérés Claude avec allowManagedHooksOnly ;
- requirements.toml Codex avec hooks activés et allow_managed_hooks_only ;
- provider/gateway obligatoire pour le trafic réglementé ;
- preuve de santé et alerte en cas de perte de couverture.

## 14. Décisions rejetées

| Option                                  | Décision     | Motif                                                                                     |
| --------------------------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| Overlay sur bouton tiers                | Rejetée      | DOM interdit, couverture trompeuse                                                        |
| SLM au V0                               | Rejetée      | coût et opacité sans besoin démontré                                                      |
| Python sur le hot path extension        | Rejetée      | packaging, cold start, double implémentation                                              |
| Binaire Go Gitleaks au V0               | Non embarqué | excellente référence, mais contraire au core TypeScript unique et plus lourd à distribuer |
| Regex JavaScript dynamiques/arbitraires | Rejetées     | risque ReDoS et règles non sûres                                                          |
| MCP comme garde universel               | Rejeté       | appelé après exposition potentielle et erreurs fail-open                                  |
| MITM réseau transparent                 | Rejeté       | fragile, invasif, incomplet                                                               |
| Troncature puis allow                   | Rejetée      | tail non scannée ; toute entrée > 1 MiB est bloquée                                       |
| Validation réseau des tokens            | Rejetée      | fuite, latence, effets de bord                                                            |
| « confiance 99,8 % » non calibrée       | Rejetée      | faux niveau de précision                                                                  |

## 15. Sources primaires

Sources vérifiées le 11 septembre 2026 :

- [VS Code 1.137 — release notes](https://code.visualstudio.com/updates/v1_137)
- [VS Code Extension Capabilities — pas d’accès DOM](https://code.visualstudio.com/api/extension-capabilities/overview)
- [VS Code Agent Hooks — Preview](https://code.visualstudio.com/docs/agent-customization/hooks)
- [VS Code Hooks Reference — UserPromptSubmit](https://code.visualstudio.com/docs/agents/reference/hooks-reference#_userpromptsubmit)
- [VS Code Chat Participant API](https://code.visualstudio.com/api/extension-guides/ai/chat)
- [VS Code Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider)
- [VS Code Language Model Tool API](https://code.visualstudio.com/api/extension-guides/ai/tools)
- [VS Code Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Claude Code Hooks — UserPromptSubmit et timeouts](https://code.claude.com/docs/en/hooks#userpromptsubmit)
- [Claude Code IDE integrations](https://code.claude.com/docs/en/ide-integrations)
- [Claude Code managed settings](https://code.claude.com/docs/en/configuration#hook-configuration)
- [Codex Hooks](https://learn.chatgpt.com/fr-FR/docs/hooks)
- [Codex configuration — CLI/IDE et maturité Stable](https://learn.chatgpt.com/fr-FR/docs/config-file/config-basic)
- [google/re2-wasm — Apache-2.0](https://github.com/google/re2-wasm)
