# Front de démonstration — plan de refonte

> Le brief : refondre la page publique de xSOM AI Guard (hero, menaces, « pour qui »,
> démo), l'aligner sur la charte de `xsom.fr`, et écrire une documentation « comment ça
> marche ». Ce document est le plan, pas la livraison. Il dit d'abord ce que la
> vérification a trouvé, parce que **trois constats changent le brief** — et il finit
> par les décisions qui appartiennent à Julian.
>
> Méthode : quatre relevés de terrain contre le code, trois directions indépendantes,
> chacune attaquée par deux relecteurs chargés de la réfuter. Treize agents.

---

## 1. Ce que la vérification a trouvé, et qui change le brief

### 1.1 Les vidéos n'existent pas, et huit menaces sur seize seulement ont de quoi en faire une

Zéro fichier vidéo dans le dépôt, tous formats confondus. `SM-13` (« 100 % des vidéos
publiées ») est aujourd'hui satisfaite **par le vide**, et `AD-26` fixe leur nature :
*une vidéo est l'enregistrement d'une exécution qui passe, jamais son substitut.*

La matière probante, elle, est réelle : 53 scénarios au vert. Mais le chiffre honnête
n'est pas seize, ni même onze :

| | Lignes | Lesquelles |
|---|---|---|
| Preuve **complète en trois parties** (bloque · laisse passer · contrôle négatif) | **8** | `M-02`, `M-06`, `M-07`, `M-08`, `M-10`, `M-11`, `M-12`, `M-14` |
| Scénario trop mince pour être montré | 3 | `M-13` (sans contrôle négatif), `M-01` et `M-15` (verdict tiers seul) |
| Aucun scénario | 5 | `M-03`, `M-04`, `M-05`, `M-09`, `M-16` |

Seule la preuve en trois parties donne une séquence démontrable, parce qu'elle montre
aussi **ce qui se passe quand on retire le garde**. Filmer un blocage sans son contrôle
négatif, c'est filmer un écran où rien ne se passe : un plantage, un aval injoignable ou
un nom d'outil mal orthographié produisent la même image.

**Conséquence** : promettre seize vidéos est impossible sans en fabriquer huit. Le plan
ci-dessous en produit huit, générées, et publie franchement ce que sont les huit autres.

### 1.2 La page actuelle affirme déjà plus que la carte

`lib/i18n.tsx` porte quatre chiffres écrits en dur dans le hero, dont un **« < 1 s »**
que le registre de surcoût du dépôt refuse explicitement de publier. C'est la faute que
`CM-7`, l'audit de souveraineté et le registre de surcoût existent pour empêcher —
transposée sur la surface marketing, où rien ne la garde.

Accessoirement : le tiret que tu veux retirer est dans une seule chaîne, mais **le tic
est global — 88 chaînes du dictionnaire en portent un.**

### 1.3 L'erreur d'unité : la carte prouve des **facettes**, la page veut lister des **lignes**

C'est le constat le plus important, et **les six relecteurs l'ont trouvé
indépendamment** : les trois directions proposées commettaient toutes la même faute.

Vérifié en rejouant `core/triage.py` sur `coverage/map.json` : pour le profil `P1a`,
« 8 lignes sur 16, dont 3 bloquées » est faux — le moteur dit 8 lignes applicables et
**2 lignes** bloquées. Le 3 est un compte de *facettes*, lu dans la mauvaise colonne.

Une page qui se vend comme « généré depuis la carte » et qui se trompe d'unité perd la
réunion sur ce seul point. **Règle du chantier : aucun chiffre par ligne de menace n'est
écrit à la main ; tout passe par le moteur que le produit utilise déjà.**

### 1.4 La vérification de chaîne dans le navigateur est interdite

Les deux directions qui en faisaient leur clou l'ont perdu : recalculer la chaîne côté
navigateur demande **une seconde implémentation de `payload_v1` et `canonical_ts` en
TypeScript**, ce que `core/audit.py` interdit nommément — une seconde convention de
sérialisation finit par diverger de la première, et la chaîne déjà écrite devient
invérifiable sans qu'aucun test le voie.

La page peut *donner* le vérificateur autonome (`scripts/verify_chain.py`) et expliquer
comment le lancer. Elle ne peut pas le réimplémenter.

### 1.5 Le compte de démonstration partagé est un piège, dans ce produit précisément

Six constats, tous vérifiés :

1. **Les routes de lecture n'exigent aucun rôle.** `api/audit.py`, `api/compliance.py`,
   `api/policy.py` ne demandent que `get_current_user`. Un compte `viewer` lit **tout**,
   y compris ce qu'on n'avait pas prévu de montrer — et toute route de lecture ajoutée
   plus tard.
2. **Le proxy front relaie n'importe quelle méthode vers n'importe quel chemin** de
   l'API avec le jeton de session, sans allowlist. Le rôle du compte devient l'unique
   contrôle de sécurité.
3. **La rédaction des arguments d'approbation se fait par nom de clé, pas par valeur.**
   Ce qu'un visiteur tape dans un champ nommé `body` ou `to` est stocké tel quel et lu
   par tous les visiteurs suivants.
4. **`audit_log` est ineffaçable par construction** : deux triggers bloquent `UPDATE` et
   `DELETE` pour tout le monde, propriétaire compris. Ce qu'un visiteur écrit y reste
   pour toujours.
5. **Le rate limit ne fait pas ce qu'on croit** : `get_remote_address` lit
   `request.client.host` et jamais `X-Forwarded-For`, et l'image lance `uvicorn` sans
   `--proxy-headers`. Derrière un edge, c'est **un compartiment unique partagé** — un
   visiteur met la démo en 429 pour tous les autres avec une boucle triviale.
6. **La policy de démo exécute `shell.bash`** (`cat`, `ls`, `head`, `grep`) sans humain,
   et le gateway relaie vers des sous-processus. Une démo « vivante » sur ce tenant est
   une surface d'exécution.

Et il n'existe **aucun identifiant** pour se connecter à la démo aujourd'hui :
`seed_demo.py` tire un tenant neuf à chaque exécution et jette le secret du jeton.

Un mot de passe public partagé est exactement l'anti-patron qu'un RSSI cherche en
évaluant un produit de gouvernance : ni identité, ni traçabilité, ni révocation. La
démo devient une pièce à charge dans la conversation qu'on voulait gagner.

---

## 2. Le parti pris retenu

**Le relevé, pas la plaquette.** La page publique est un document daté, signé par un
commit, où chaque affirmation porte son mode de couverture, son chemin d'entrée et le
scénario qui la prouve — et où ce qui n'est pas prouvé le dit.

C'est la synthèse des trois directions, corrigée par les attaques. Elle tient parce que
c'est la seule chose que ce produit a et que ses concurrents n'ont pas : la carte est
générée, le journal est recalculable, et un gate fait tomber le build sur une
revendication non appuyée. Le reste du marché écrit ses promesses à la main.

### 2.1 Ce qui fait que ça ne ressemble pas à une sortie d'IA

Le système de design de `xsom.fr` **documente déjà cette règle**, et c'est ce qui le
rend précieux : `base.css` neutralise la classe `.em` (l'italique serif cuivre sur les
mots-clés) avec le motif écrit noir sur blanc — *c'est la composition la plus
reconnaissable des pages générées automatiquement.* Le fichier tient aussi le journal
de ses propres échecs de contraste, avec la valeur fautive citée à côté de la corrigée.

On le porte tel quel plutôt que d'inventer un style. Concrètement :

- **Cuivre métallique, jamais un aplat.** `--copper-metal` superpose un reflet diagonal
  sur un corps vertical à cinq arrêts, avec une rupture franche 47 % → 53 % qui simule
  la cassure de lumière sur une surface bombée. Sans lui, les boutons redeviennent
  orange.
- **Trois voix typographiques** : Saira (descendue de la DIN, la lettre des plans
  d'infrastructure) pour les titres, Inter pour le corps, JetBrains Mono pour **toute**
  étiquette et tout chiffre. Le POC n'en a qu'une aujourd'hui.
- **Rayons quasi droits** (3 / 4 / 6 px), assumés comme registre technique.
- **Alternance clair/sombre section par section**, avec des jetons de texte
  **contextuels** que `.section--light` réécrit en bloc.
- **Polices auto-hébergées** (103 Ko au total), parce que le cabinet s'auto-héberge
  précisément pour ne transmettre aucune adresse IP de visiteur à un tiers. Passer par
  `next/font/google` serait une régression de doctrine.
- Ce que ça **refuse** : pas de grille de cartes à ombre douce, pas de pilules, pas de
  gradients décoratifs, pas de « Ils nous font confiance » sans clients à nommer.

### 2.2 Le hero, sans tiret

Ta phrase, coupée par un point plutôt que par un tiret :

> **Déployez vos agents IA en production. Sans perdre le contrôle.**

C'est la correction minimale et fidèle, et le point est déjà la ponctuation du site mère
(« L'IA avance vite. »). Une alternative plus spécifique, si tu veux ouvrir plus fort :

> **Vos agents IA agissent. xSOM AI Guard décide si l'action a lieu.**

À trancher — voir §5.

### 2.3 La section menaces

Un **relevé pleine largeur**, pas une grille : seize rangées séparées d'un filet 1 px,
numéro `M-01`…`M-16` en mono cuivre dans une gouttière fixe, titre en Saira, mode publié
entre crochets (`[ B ]` Bloqué, `[ D ]`, `[ O ]`, `[ A ]`, `[ X ]`), chemin d'ingestion,
et la densité de preuve rendue en barres mono plutôt qu'en chiffre — un relevé se lit
d'un coup d'œil, un chiffre se lit ligne à ligne.

**Au clic**, la rangée s'ouvre. Trois contenus possibles, selon ce que la ligne a
réellement :

- **Les 8 lignes à preuve complète** → le **rejeu** : le même appel d'outil joué deux
  fois, garde retiré à gauche, garde actif à droite, animé depuis la trace d'audit
  réelle. C'est la « vidéo », et c'est la seule forme qui met le contrôle négatif à
  l'écran.
- **Les 3 lignes à scénario mince** → ce que le scénario prouve, et ce qu'il ne prouve
  pas, dit en une phrase.
- **Les 5 lignes sans matière** → la raison publiée dans la carte : *qui porte cette
  ligne, et pourquoi ce n'est pas nous.* Dit franchement, c'est un argument commercial
  plus fort qu'une vidéo de plus.

En tête de section, un **sélecteur de profil** (P1a … P5) qui recalcule en direct, par
le moteur `core/triage.py`, ce qui s'applique au visiteur.

### 2.4 « Pour qui »

Pas une liste de secteurs. Le visiteur coche sa situation et la page lui rend **son**
sous-ensemble de menaces applicables, avec les bascules écrites en clair (« devient la
vôtre le jour où… »). C'est ce qui le fait se sentir concerné : il ne lit pas une liste
générique, il lit son propre relevé.

Les chiffres viennent du moteur, jamais du TSX — cf. §1.3.

### 2.5 La démo

Deux portes, nommées différemment et **jamais mélangées** :

**Porte 1 — l'instantané vérifiable, accessible à tous, sans compte ni backend.**
Quatre écrans réels de la console (inspecteur, file d'approbation, explorateur d'audit,
synthèse dirigeant) alimentés par un **artefact JSON committé**, produit par l'export
réel du tenant de démonstration. Bandeau permanent : *instantané du tenant de
démonstration, généré le …, commit …, lecture seule.* Le précédent existe déjà et
fonctionne : `/executive-preview` est une page publique hors middleware, avec bandeau
assumé — on garde le mécanisme et on remplace ses chiffres inventés par un export réel.

**Porte 2 — l'accès nominatif, en trente secondes.** Un formulaire, un compte réel,
révocable, tracé. C'est plus long qu'un mot de passe public et c'est **l'argument** :
un produit de gouvernance qui distribuerait un compte partagé se contredirait.

Le compte public partagé est écarté pour les six raisons du §1.5. Si tu le veux quand
même, il faut d'abord fermer les six — c'est un lot à part entière, pas une case à
cocher.

### 2.6 « Comment ça marche »

Une page `/mise-en-oeuvre`, organisée par **ce que le lecteur peut modifier**, dans
l'ordre décroissant de garantie :

1. **Passerelle MCP** — contraignante : xSOM exécute ou n'exécute pas. Livré : le bloc
   de configuration MCP.
2. **`POST /v1/authorize`** — coopérative : l'agent honore le verdict. Pour les agents
   dont on contrôle le code. Livré : une vingtaine de lignes de Python.
3. **Proxy LLM** — DLP d'egress contraignante. Livré : le changement de `base_url`.

La page n'invente rien : elle **extrait** de `README.md` et `docs/DEPLOY.md`, qui
restent la source. Une capture animée de `make demo` sert d'ouverture.

---

## 3. Le gate, sans quoi tout le reste est du marketing

C'est la pièce qui rend le chantier sûr, et les trois directions l'ont proposée
indépendamment : **`scripts/gen_marketing.py --check`**, sur le modèle de `CM-7`.

Il vérifie que tout chiffre et tout badge publiés sur la page proviennent de
`coverage/map.json` et du moteur de triage, par l'**unité correcte** (§1.3), et fait
échouer le build sinon. La page ne peut alors plus dériver de ce que le produit prouve
— c'est la même garantie que le tableau de `POSITIONNEMENT.md`, sur une surface plus
exposée.

---

## 4. Les lots

Ordonnés. Chacun est autonome, vérifiable, et livrable en PR séparée.

| # | Lot | Contenu | Pourquoi à cette place |
|---|---|---|---|
| **L0** | **Assainissement** | Retirer les quatre chiffres non adossés du hero, à commencer par le « < 1 s ». Retirer les 88 tirets. | Une faute de doctrine est en ligne maintenant. Rien ne se construit par-dessus. |
| **L1** | **Fondations de marque** | Porter les jetons cuivre, les trois polices auto-hébergées, les rayons, les jetons contextuels clair/sombre. | Tout le visuel en dépend. |
| **L2** | **Socle des pages publiques** | Sortir du `"use client"` global pour retrouver `metadata`, OG et `<html lang>`. ~~Routes de langue.~~ | **Fait, sauf les routes de langue** — voir §5 ter. Le français est indexable, l'anglais ne l'est pas. |
| **L3** | **Exposer la carte au front** | ~~Un endpoint ou un artefact committé~~ **les deux** : l'artefact pour le statique, la route pour le profil-dépendant. | **Fait** — voir §5 quater. |
| **L4** | **Le gate marketing** | `gen_marketing.py --check`, en CI. | **Avant** d'écrire la page, pas après. |
| **L5** | **Le relevé des menaces** | La section, le sélecteur de profil, les trois contenus d'ouverture. | Le cœur. |
| **L6** | **Le rejeu** | Étendre le hook pytest qui écrit déjà `.scenarios.json` pour capturer la séquence d'audit ; un générateur ; un lecteur. Les 8 lignes. | Les « vidéos ». Dépend de L5 pour son emplacement. |
| **L7** | **Pour qui** | La section, adossée au moteur de triage. | |
| **L8** | **La démo, porte 1** | L'instantané généré, les quatre écrans, le bandeau. | |
| **L9** | **`/mise-en-oeuvre`** | Les trois voies, la capture de `make demo`. | |
| **L10** | **Porte 2, l'accès nominatif** | Formulaire, compte réel, révocation. | Optionnel — voir §5. |
| **L11** | *(conditionnel)* **Durcir pour un compte public** | Les six correctifs du §1.5. | Seulement si tu tranches en faveur du compte partagé. |

---

## 5. Décisions prises

Tranchées par Julian le 2026-09-06 :

| Question | Réponse |
|---|---|
| **Hero** | Sa phrase, coupée par un point : **« Déployez vos agents IA en production. Sans perdre le contrôle. »** |
| **Démo** | **Instantané + accès nominatif.** Le compte public partagé est écarté ; le lot `L11` ne sera pas construit. |
| **Portée** | **Tout, `L0` → `L9`.** |
| **Emplacement** | **Les deux** : la page dans le POC, adossée aux artefacts générés ; plus une page d'entrée sur `infra-xsom_website` qui y renvoie. |
| **Les 8 menaces sans rejeu** | Publiées franchement pour ce qu'elles sont — décidé par moi, faute de contre-indication : c'est la seule option cohérente avec le reste du dépôt. |

### 5 bis. Ce que « les deux » implique

La page vit dans le POC et reste adossée à `coverage/map.json` et au moteur de triage,
donc le gate marketing tourne dans la même CI. Le vitrine reçoit une **page d'entrée**
qui renvoie vers elle : elle ne duplique aucun chiffre, sans quoi il faudrait un second
gate sur un dépôt où il ne pourrait pas s'exécuter.

---

## 5 ter. Ce que `L2` a livré, et ce qu'il a coûté

Le socle est posé : `app/page.tsx` et `app/executive-preview/page.tsx` sont redevenus
des composants **serveur**, le dictionnaire est sorti de `lib/i18n.tsx` vers
`lib/strings.ts` pour que le serveur puisse le lire, et la langue tient dans un cookie
que le serveur relit avant de rendre. Le site démarre en français, `<html lang>` dit
enfin la vérité, et chaque page publique porte un titre et une description.

**Mesuré, pas estimé.** La page d'accueil passe de **2,56 ko à 187 o** de JS de page :
le balisage entier ne part plus dans le navigateur. Elle passe aussi de statique (`○`)
à rendue à la demande (`ƒ`), ce qui **ne coûte rien de réel** : le `matcher` du
middleware est `/((?!_next/static|_next/image|favicon.ico).*)`, il attrapait déjà `/`,
et aucune requête n'était donc servie depuis un cache statique avant ce lot.

**Le coût, lui, est ailleurs, et il est assumé.** La langue tenant à un cookie, les
deux versions partagent une URL. `alternates.languages` a donc été **retiré** du layout
racine : il déclarait un `hreflang` `en` pointant sur `/`, ce qui était faux. La
conséquence se dit sans détour : **seul le français est indexable.** Un robot n'a pas
de cookie, il verra le français, ce qui est le marché visé — mais l'anglais n'entrera
dans aucun index tant qu'il n'aura pas sa propre route. C'est la moitié de `L2` qui
n'est pas faite, et elle est nommée ici plutôt que passée sous silence.

**Une hypothèse vérifiée, puis abandonnée.** J'avais relevé que le middleware appelle
`supabase.auth.getUser()` sur *tous* les chemins, y compris la page d'accueil, et donc
qu'un visiteur anonyme payait un aller-retour réseau pour rien. Mesure faite en
pointant `NEXT_PUBLIC_SUPABASE_URL` sur un serveur qui compte ses requêtes : **zéro
appel** sur trois visites anonymes de `/`. Sans cookie d'authentification, `getUser()`
court-circuite localement. Le défaut n'existe pas, et le correctif n'a pas été écrit.

---

## 5 quater. Ce que `L3` a livré

Le socle de données du relevé, dans la bonne unité, et l'unité est tout le lot.

**Le regroupement n'a qu'une implémentation.** `core/threat_map.py` convertit les 25
facettes de `coverage/map.json` en 16 lignes de menace. `core/triage.py` le faisait en
interne ; il s'appuie désormais dessus, vérifié sans effet de bord sur cinq
combinaisons de profils. Le front n'en écrira pas une seconde version en TypeScript,
ce que les six relecteurs avaient anticipé et que le §1.3 nomme.

**La frontière entre le statique et le profil-dépendant est tenue par un test.**
`frontend/lib/generated/threat-rows.json` (20 Ko, généré, gaté en CI) porte ce qui ne
dépend d'aucun visiteur : les lignes, leurs facettes, le mode publié, les profils
concernés, les scénarios, les écarts. Il ne porte **ni** applicabilité, **ni** plafond,
**ni** propriétaire, **ni** compte — un test refuse ces six mots dans le fichier, parce
qu'un artefact qui les porterait serait un second moteur endormi. Ces notions-là se
demandent à `GET /v1/threats?profiles=`, servi par `core.triage`.

**Les huit lignes rejouables tombent de la carte.** `rejouable` = « une facette y est
publiée `Bloqué` », et `gen_coverage.py` n'accorde `Bloqué` qu'avec les deux moitiés de
la preuve, le blocage **et** son contrôle négatif. Aucune liste n'est tenue à jour : le
§1.1 annonçait 8 lignes sur 16, le générateur en trouve 8 — `M-02`, `M-06`, `M-07`,
`M-08`, `M-10`, `M-11`, `M-12`, `M-14`. `L6` filmera celles-là et pas d'autres.

**La route est publique, et le gel de surface l'a exigée par écrit.**
`tests/test_public_surface.py` est passé au rouge à l'ajout de `GET /v1/threats`, en
dev comme en production, jusqu'à ce que la route soit inscrite avec sa raison. C'est le
comportement voulu : une route publique nouvelle ne passe pas la CI sans qu'on relise
`FR-168` dans le diff qui l'ajoute.

**Le chiffre qui a coûté la réunion, figé.** Un test tient l'écart `P1a` : 2 lignes
bloquées, 3 facettes bloquées — et il échoue aussi le jour où les deux coïncideraient,
parce qu'il ne prouverait alors plus rien.

---

## 6. Ce qui reste ouvert


- **L'écriture sur `infra-xsom_website`.** Je n'y ai pas d'accès aujourd'hui. Si la
  demande d'attachement échoue, la page d'entrée sera livrée comme un fichier prêt à
  committer plutôt que poussée.
- **Les six correctifs de sécurité du §1.5** restent vrais même sans compte public
  partagé. Trois méritent d'être corrigés indépendamment de ce chantier : l'absence
  d'allowlist sur le proxy front, le rate limit inopérant derrière un edge, et la
  rédaction des arguments d'approbation par nom de clé. Ce sont des constats de
  sécurité produit, pas des dépendances de la page — à traiter dans leur propre lot.
