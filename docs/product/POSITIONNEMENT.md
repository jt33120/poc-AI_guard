# Positionnement — les alternatives réelles, et la proposition à deux étages

> `FR-197`, réponse à `EXH-9`. Ce document nomme les concurrents, dit où nous gagnons
> et où nous perdons, profil par profil, et énonce la proposition de valeur à deux
> étages. Il n'est pas un argumentaire : c'est le document qu'on relit quand un
> prospect nous compare, et il doit rester vrai après cette comparaison.

---

## 1. Ce que la carte générée oblige à dire

Le positionnement de la v2 tenait sur une phrase : *« nous contrôlons ce que l'agent
fait, pas seulement les prompts »*. Elle reste vraie. Mais depuis que la carte de
couverture est **générée** depuis les scénarios qui passent (`AD-30`) et que chaque
revendication porte son chemin d'ingestion (`AD-28`), le produit publie lui-même le
chiffre qui nuance cette phrase :

| Chemin d'ingestion | Facettes publiées `Bloqué` |
|---|---|
| `mcp` seul | **7** |
| `http` + `mcp` | 1 |
| `llm_proxy` seul | 1 |

**Sept revendications de blocage sur neuf ne sont prouvées que sur MCP.** Ce n'est pas
une faiblesse à cacher : c'est la conséquence d'une architecture où le gateway MCP est
la seule porte *obligatoire* — un agent ne peut pas la contourner — tandis que
`/v1/authorize` est coopératif (l'agent peut simplement ne pas demander) et que le
proxy LLM retire un appel d'outil d'une réponse plutôt que de s'interposer entre
l'agent et l'acte.

`EXH-9` a raison sur le fond : *sur le chemin non-MCP, ce que xSOM ajoute est le
**registre**, pas l'enforcement.* C'est un produit défendable, mais c'est une phrase
différente, et elle n'était écrite nulle part. La voici.

---

## 2. La proposition à deux étages

**Étage 1 — sur MCP : enforcement obligatoire et preuve vérifiable.**
L'agent passe par le gateway ou n'agit pas. La policy s'applique, l'humain est dans la
boucle sur l'irréversible au niveau du gateway et jamais délégué au LLM, et chaque
décision entre dans un journal hash-chaîné qu'un auditeur recalcule sans nous faire
confiance. C'est là que la phrase « nous contrôlons ce que l'agent fait » est
littéralement vraie, et c'est ce que la carte prouve sur sept facettes.

**Étage 2 — sur les autres chemins : policy unifiée et preuve vérifiable.**
Sur `/v1/authorize` et le proxy LLM, le framework possède déjà l'interruption
d'approbation. Ce que nous apportons : **une seule policy** pour tous les chemins au
lieu d'une par framework, et **le même registre vérifiable**. Les décisions qui
arrivent par là sont étiquetées `cooperative` et `C-7` leur interdit de compter comme
preuve de supervision équivalente — c'est cette honnêteté d'étiquetage qui rend
l'étage 1 crédible.

Les deux étages se vendent ensemble et se prouvent séparément. Un client qui ne peut
pas router ses agents par MCP achète l'étage 2 en sachant ce qu'il achète ; on ne lui
vend pas l'étage 1 en espérant qu'il ne lise pas la carte.

---

## 3. Les alternatives, nommées

`EXH-9` reprochait au plan de ne nommer personne — « un hyperscaler », « un concurrent
direct ». Voici les cinq familles qui érodent réellement le positionnement.

| Famille | Ce qu'elle fait mieux | Ce qu'elle ne fait pas |
|---|---|---|
| **Passerelles d'agents des hyperscalers** (Azure AI Foundry, AWS Bedrock Agents, Google Vertex Agent Engine) | Intégration native, achat sur un contrat existant, zéro nouveau fournisseur | La preuve appartient au fournisseur du modèle. Un auditeur qui veut vérifier la chaîne dépend de celui qu'il contrôle. Et la dépendance opérationnelle est hors UE (`QO-3`) |
| **Passerelles MCP open source** (proxies MCP, serveurs d'agrégation) | Gratuites, inspectables, déjà dans les mains des équipes plateforme | Pas de journal inaltérable, pas de HITL de niveau gateway, pas d'Evidence Pack. Ce sont des routeurs, pas des points de contrôle |
| **Éditeurs d'identité qui livrent l'approbation d'agents** (Okta, Entra, et les offres « agent identity » récentes) | L'IdP est déjà payé, l'approbation arrive dans un outil que l'utilisateur ouvre déjà | L'approbation porte sur une identité, pas sur une **classe d'action** avec dry-run. Et la preuve reste dans leurs journaux, pas dans une chaîne recalculable |
| **Registres à preuve d'intégrité** (ledgers, journaux scellés, horodatage qualifié) | Meilleure garantie d'inaltérabilité que la nôtre, ancrage externe mature | Ils prouvent qu'un enregistrement n'a pas bougé. Ils ne décident rien, et n'ont aucune idée de ce qu'est une action irréversible |
| **Les hooks HITL des frameworks** (LangGraph, OpenAI Agents SDK, Claude Agent SDK, CrewAI) | Gratuits, dans le code de l'agent, zéro latence réseau | **Coopératifs par construction** : l'agent, ou son auteur, peut ne pas appeler le hook. Aucune policy partagée entre frameworks, aucun registre commun |

**La ligne qui nous reste, et elle est étroite :** être le seul point où
l'enforcement est *obligatoire* sur un chemin, la policy est *unique* sur tous, et la
preuve est *vérifiable sans nous*. Chacune des trois pattes existe ailleurs ; les
trois ensemble, non — et c'est la seule formulation de l'« intersection inoccupée » qui
résiste à un examen.

---

## 4. Où nous gagnons, où nous perdons — par profil

`EXH-9` demandait une ligne gain/perte par JTBD. La PRD de strate a remplacé les JTBD
par les **profils d'usage** (`PRD` §2.2), qui décrivent mieux le terrain : la table
suit donc les profils.

| Profil | Où nous gagnons | Où nous perdons | Alternative la plus dangereuse |
|---|---|---|---|
| **P1a** — API hyperscaler | Le client veut une preuve que son fournisseur de modèle ne produit pas lui-même | Si tout est déjà dans un seul cloud et que la conformité s'y achète en case à cocher | Passerelle d'agents de l'hyperscaler |
| **P1b** — IA embarquée SaaS | Nulle part, et nous le publions : la colonne `Bloqué` y est **structurellement à zéro** (`FR-174`) | Partout. Aucune frontière d'outils ne s'intercale devant un assistant encastré dans une suite | L'éditeur de la suite lui-même |
| **P2** — RAG interne | L'injection indirecte est une menace d'**action**, pas de prompt : le taint persiste sur le jeton et abaisse le plancher | Si le client cherche un filtre de contenu, nous ne sommes pas ça et ne devons pas le prétendre | Garde-prompts et filtres de sortie |
| **P3** — Agents outillés | Le cœur. Enforcement obligatoire, HITL sur l'irréversible, preuve recalculable — les trois pattes à la fois | Si l'équipe est petite et que le hook HITL de son framework suffit à son risque réel | Les hooks natifs des frameworks |
| **P4** — Poids ouverts hébergés | La souveraineté est une **propriété de CI** ici (`SM-15` = 0 appel sortant sur le chemin de décision), pas un argument de localisation | Si le client héberge déjà tout et considère que l'isolement réseau suffit | Rien de vendu — l'inertie interne |
| **P5** — Entraînement / fine-tuning | Hors priorité, assumé | La chaîne d'outils MLOps couvre le terrain | Outillage MLOps |

**Ce que cette table coûte à dire** : sur P1b nous perdons par construction, et sur P3
— notre cœur — l'alternative gratuite est souvent suffisante pour un risque faible. Un
positionnement qui ne l'écrirait pas serait démenti au premier appel technique.

---

## 5. Ce que la passerelle coûte par appel

`EXH-9` a une seconde moitié :

> *« An inline gateway with no published p95 overhead number will be rejected on that
> basis alone. »*

Le constat est juste. La réponse évidente serait un p95 en millisecondes, et ce
document n'en publie pas — délibérément. Un chiffre de latence n'engage que si les
conditions qui l'ont produit ressemblent à celles du lecteur : notre cluster de mesure
tourne `fsync=off`, et un exécuteur CI partagé n'a pas de p95 reproductible. Le
publier en l'appelant « notre surcoût » dirait plus que ce qu'il prouve.

Ce qui est publié, généré par `scripts/measure_overhead.py` depuis ce que la suite
mesure, et gaté en CI :

| Chemin | Connexions PostgreSQL | Allers-retours SQL |
|---|---|---|
| MCP — appel autorisé | 2 | 5 |
| MCP — appel refusé | 2 | 5 |
| MCP — première mise en attente | 3 | 7 |
| `POST /v1/authorize` — autorisé | 4 | 8 |
| `POST /v1/authorize` — refusé | 4 | 7 |

**Comment lire ce tableau.** Il n'y a pas de pool : `core/db.py` ouvre une connexion
neuve par opération. Multipliez donc ces entiers par la latence d'établissement de
*votre* base pour obtenir le surcoût chez vous — c'est un chiffre que vous connaissez
et que nous ne pouvons pas connaître à votre place. Trois gardes sont éteintes par
défaut (intégrité, bandes de risque, taint) et ajoutent une à deux connexions chacune
quand on les active ; `perf/overhead.json` les nomme.

**Ce que le tableau dit sur nous.** Le chemin coopératif coûte **deux fois** les
connexions du chemin obligatoire, parce qu'il ré-authentifie le jeton et relit la
policy à chaque requête là où MCP tient une session. C'est le prix de la
non-obligation, et il va dans le même sens que le §1 : l'étage MCP n'est pas seulement
le plus contraignant, il est aussi le moins cher.

**Ce que la lecture du droit achète, sur les deux portes.** Le palier et les plafonds
du tenant sont lus à chaque appel et **jamais mis en cache**. C'est un choix, pas une
négligence : un droit servi de mémoire est un droit qu'on ne peut plus retirer, et la
fenêtre pendant laquelle il survivrait est exactement celle où un client rétrogradé a
intérêt à continuer. Le palier, les capacités, les plafonds, les quotas négociés et la
consommation du mois tiennent en **une seule** requête — trois lectures séparées
faisaient passer le chemin coopératif de six à onze allers-retours, et c'est le gate de
surcoût qui l'a dit avant la revue.

La porte MCP paie cette lecture depuis peu, et l'écart se lit dans le tableau : une
connexion et deux allers-retours de plus par appel. C'est ce que coûte le fait que la
gamme s'applique là où le produit **exécute**. Sans elle, un plafond de plan ne
resserrait que la voie qu'un agent peut ne pas emprunter, et le compteur d'usage d'un
déploiement MCP — celui que nous recommandons — restait à zéro.

**Ce que chercher ce chiffre a trouvé.** Le premier constat n'a pas été une latence à
publier mais un défaut à corriger : `/v1/authorize` et le proxy LLM ré-analysaient le
document de policy à chaque requête — ~288 µs contre 1,3 µs pour la décision que ce
parse sert, soit **230 fois**. Corrigé par mémoïsation, et le gate d'entiers ci-dessus
existe pour que la prochaine régression de ce genre soit vue au build suivant plutôt
qu'en clientèle.

Reste ouvert : les figures de **capacité** qu'`EXH-9` demande aussi (appels par seconde
soutenus, pic de connexions simultanées). Elles dépendent d'un profil de charge que
nous n'avons pas encore, et les inventer serait retomber dans ce que ce paragraphe
refuse.

---

## 6. Ce que ce document interdit de dire

- « Nous bloquons » sans nommer le chemin. Seul le mode `Bloqué` licencie le verbe
  (`FR-175`), et il porte son ingestion (`AD-28`).
- « Compatible avec n'importe quel fournisseur d'identité. » Corrigé par `FR-195` :
  nous fédérons les émetteurs présentant des **revendications compatibles**.
- « Intersection inoccupée » sans les trois pattes. Chacune existe ailleurs.
- Un surcoût de latence, tant que §5 reste ouvert.
