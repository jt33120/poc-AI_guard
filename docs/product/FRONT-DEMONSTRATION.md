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

**Au clic**, la rangée s'ouvre. **Quatre** contenus possibles, selon ce que la ligne a
réellement — trois étaient prévus, la mesure en a imposé un quatrième :

- **Les 8 lignes à preuve complète** → le **rejeu** : le même appel d'outil joué deux
  fois, garde retiré à gauche, garde actif à droite, animé depuis la trace d'audit
  réelle. C'est la « vidéo », et c'est la seule forme qui met le contrôle négatif à
  l'écran.
- **Les 3 lignes à scénario mince** → ce que le scénario prouve, et ce qu'il ne prouve
  pas, dit en une phrase.
- **Les 3 lignes qui publient une raison** (`M-04`, `M-05`, `M-09`, toutes `Hors
  périmètre`) → la raison publiée dans la carte : *qui porte cette ligne, et pourquoi
  ce n'est pas nous.* Dit franchement, c'est un argument commercial plus fort qu'une
  vidéo de plus.
- **Les 2 lignes `Attesté` sans matière** (`M-03`, `M-16`) → ce qu'`Attesté` revendique,
  et ce qu'il ne revendique pas. **Ce quatrième cas n'était pas prévu** : ce paragraphe
  annonçait cinq lignes « sans matière » sous la raison publiée, et la mesure en donne
  trois. `M-03` et `M-16` n'ont ni scénario ni raison ; les ranger avec les autres
  aurait affiché un cadre vide ou une raison inventée. Corrigé en `L5`, dérivé par
  `core.threat_map.PublishedRow.ouverture`, tenu par un test.

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
| **L4** | **Le gate marketing** | `gen_marketing.py --check`, en CI. | **Fait, et avant la page** — voir §5 quinquies. |
| **L5** | **Le relevé des menaces** | La section, le sélecteur de profil, ~~les trois~~ **les quatre** contenus d'ouverture. | **Fait** — voir §5 sexies. |
| **L6** | **Le rejeu** | Le hook de capture, le générateur, le lecteur. ~~Les 8 lignes.~~ **7 rejeux + 1 raison publiée.** | **Fait** — voir §5 septies. |
| **L7** | **Pour qui** | La section, adossée au moteur de triage : **les bascules**, et le profil sur lequel nous perdons. | **Fait** — voir §5 octies. |
| **L8** | **La démo, porte 1** | L'instantané généré, ~~les quatre écrans~~ **les deux que la fixture alimente**, le bandeau. | **Fait** — voir §5 nonies. |
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
`M-08`, `M-10`, `M-11`, `M-12`, `M-14`.

*Corrigé après coup par `L6`* : sept d'entre elles sont effectivement rejouables.
`M-14` ne l'est pas, et pour une raison de fond — sa preuve est qu'un argument secret
**n'atteint pas** le journal, si bien que les deux exécutions autorisent légitimement
l'appel et qu'il n'y a rien à mettre côte à côte. « Rejouable » et « publiée `Bloqué` »
ne coïncident donc pas tout à fait, et le §5 septies dit lequel des deux la page
annonce.

**La route est publique, et le gel de surface l'a exigée par écrit.**
`tests/test_public_surface.py` est passé au rouge à l'ajout de `GET /v1/threats`, en
dev comme en production, jusqu'à ce que la route soit inscrite avec sa raison. C'est le
comportement voulu : une route publique nouvelle ne passe pas la CI sans qu'on relise
`FR-168` dans le diff qui l'ajoute.

**Le chiffre qui a coûté la réunion, figé.** Un test tient l'écart `P1a` : 2 lignes
bloquées, 3 facettes bloquées — et il échoue aussi le jour où les deux coïncideraient,
parce qu'il ne prouverait alors plus rien.

---

## 5 quinquies. Ce que `L4` a livré

`scripts/gen_marketing.py --check`, en CI, écrit **avant** la page. L'ordre n'est pas
un détail : écrit après, le gate aurait été taillé pour laisser passer ce qui était
déjà là.

**La règle propre à la page :** un chiffre de couverture ne s'écrit pas, il s'interpole.
Toute chaîne mêlant un mot de couverture et un nombre doit passer par un
`{placeholder}` alimenté par `frontend/lib/generated/marketing-facts.json`, généré
depuis la carte et le moteur. Sept faits publiés : `lignes` (16), `facettes` (25),
`rejouables` (8), `profils` (6), `bloquees_max` (8), `notre_terrain_max` (13),
`ecarts` (17). Le fait « lignes » et le fait « facettes » portent deux noms différents,
si bien qu'une page ne peut plus attraper l'un pour l'autre par inadvertance — c'est le
§1.3 fermé à la source des chiffres eux-mêmes.

**`FR-175` est étendu à la copie**, avec le même motif recopié : deux expressions
régulières qui divergeraient jugeraient deux surfaces selon deux règles.

**Cinq contournements fermés, chacun vérifié rouge :** le chiffre nu, le chiffre en
toutes lettres, le chiffre écrit dans le balisage plutôt que dans le dictionnaire, le
verbe attribué à une ligne non `Bloqué`, et le placeholder mal orthographié — qui
n'échoue pas à l'exécution, il affiche ses accolades sur la page.

**Un faux positif corrigé, et il compte autant que le reste.** La première version
refusait « une liste de menaces IA » et « un contrôle des opérations réelles » : en
français, `un` et `une` sont d'abord des articles. Dix faux positifs sur dix. `un`,
`une` et `one` sont donc hors de la liste des nombres écrits, et un test de
non-régression le tient — un gate à ce taux-là est débranché dans la semaine, et un
gate débranché ne protège rien. Le trou consenti est étroit : « nous bloquons une
menace » n'est une phrase que personne n'écrit.

**Ce que le gate ne voit pas, dit d'avance :** un nombre interpolé depuis du code n'est
pas jugé, et c'est le but — il vient de `/api/threats`, donc du moteur ; une phrase qui
affirme une couverture sans aucun mot de couverture n'est pas vue ; le verbe sans ligne
nommée est de la prose générique, comptée (30 occurrences) plutôt que refusée, comme
`FR-175` le fait déjà.

---

## 5 sexies. Ce que `L5` a livré, et les deux contradictions trouvées à l'écran

Le relevé pleine largeur est en ligne sous le héros : seize rangées séparées d'un filet,
`M-01`…`M-16` en mono cuivre dans une gouttière fixe, titre en Saira, mode publié entre
crochets, chemin d'entrée, densité de preuve en barres. Sélecteur de profil en tête,
recalculé par `core.triage`. Aucune grille de cartes, aucune ombre douce.

**Le titre lui-même passe par le gate.** « {lignes} lignes de menace » : écrire
« seize » aurait été refusé par `L4` au même titre que « 16 ». Le gate a d'ailleurs
mordu sur ma propre copie dès la première rédaction, sur « les **deux** moitiés de la
preuve » — un numéral que rien ne dérive. Reformulé en « la preuve entière », et la
phrase y gagne.

**Rendu par le serveur.** Les seize lignes sont dans le HTML de la première réponse : un
robot les voit sans exécuter de JavaScript. Seuls le sélecteur et l'ouverture des
rangées sont un îlot client.

### Deux contradictions que seul le rendu a montrées

Les types passaient, les tests passaient, le build passait. Il a fallu regarder la page.

**Première.** Avec `P1a`, `M-07` affichait « [ X ] Hors périmètre » **et** trois barres
de preuve, **et** « Prouvé sur Passerelle MCP ». Les trois scénarios et le chemin MCP
appartiennent à la facette « émission », qui est celle d'un client sous agents outillés.
Le visiteur `P1a` n'a que la facette « réception », qui ne prouve rien. La page montrait
donc une preuve qui n'était pas la sienne, à côté d'un mode qui disait le contraire —
l'erreur d'unité du §1.3, un cran plus bas. Corrigé en faisant voyager la **clé de
facette** depuis le moteur (`core.triage.LineFacet`), seule jointure stable vers
l'artefact ; le libellé n'en est pas une.

**Seconde, introduite par le correctif de la première.** Une ligne non applicable ne
retient aucune facette, si bien que filtrer sur cet ensemble vide vidait le chemin
d'entrée tout en laissant le mode publié : `M-02` affichait « [ B ] Bloqué » à côté
d'« aucun chemin d'entrée asserté ». La règle est désormais explicite : **soit la vue du
visiteur, soit la vue publiée, jamais un mélange des deux.**

Une fois les deux corrigées, la page se vérifie à l'œil : sur `P1a`, huit rangées
lumineuses, dont deux `[ B ]` — ce que dit exactement l'énoncé du moteur au-dessus.

### Ce que les tests tiennent

Cinq tests Playwright, dont un qui distingue « la page relaie » de « la page recalcule
et tombe juste » : le mock renvoie des comptes invraisemblables, et le test exige que la
page les affiche. Un autre coupe le moteur et vérifie que le relevé **ne se vide pas**.

Quatre gardes Python : les quatre ouvertures couvrent les seize lignes sans trou, chacune
a réellement ce qu'elle promet de montrer, l'artefact porte la classification pour que la
page ne classe pas, et la clé de facette permet la jointure.

### Une régression causée, et attrapée

`getByRole("button", { name: "EN" })` cherche le nom accessible en sous-chaîne : le
relevé a introduit douze boutons contenant « en » (« Empoisonnement », « Agents »,
« entraînons »). Le sélecteur était juste tant que la page était courte, ce qui est la
définition d'un sélecteur fragile. `exact: true`.

---

## 5 septies. Ce que `L6` a livré, et les trois défauts qu'il a fait tomber

Le rejeu est en ligne : deux traces d'audit **réelles**, côte à côte, capturées pendant
l'exécution de la suite de tests. `AD-26` l'exige — une vidéo est l'enregistrement d'une
exécution qui passe, jamais un substitut. Rien n'est animé ni reconstitué.

Le hook de capture tire parti d'un fait du dépôt : chaque test marqué `@covers` reçoit
une base neuve, donc son `audit_log` **est** sa séquence. Rien à soustraire.

### Trois défauts, chacun ouvert par le précédent

**Un défaut d'audit, trouvé par une règle d'affichage.** La règle d'appariement exige
que les deux colonnes exercent les mêmes outils, sans quoi « le même appel joué deux
fois » est faux — et invisiblement faux. Elle a refusé `M-11` : le contrôle négatif
enregistrait `mock.echo`, le scénario bloquant `echo`, alors que les deux tests appellent
`call_tool("echo")` avec la même policy. En remontant : un seul des cinq sites
`_audit_gate` journalisait le nom nu. **Un export d'audit filtré par nom d'outil manquait
donc toutes les mises en quarantaine.** Corrigé et livré séparément.

**Un rejeu qui ne démontrait rien.** `M-11` débloqué, le générateur a rendu 8/8, mais
`M-14` sortait avec **deux colonnes identiques**. La règle exigeait les mêmes outils, pas
des issues différentes. Or `M-14` prouve qu'un argument secret n'atteint **pas** le
journal : les deux exécutions autorisent légitimement l'appel, et ce qui les sépare est
ce que le journal ne consigne pas, par construction. La différence **est** une absence.

Exiger huit rejeux poussait donc à en publier un qui ne montre rien, soit exactement
l'écran où rien ne se passe que ce lot existe pour éviter. Le bon invariant n'est pas
« huit rejeux » mais **« aucune rangée ne s'ouvre sur du vide »** : le générateur refuse
un couple dégénéré, `M-14` est déclarée dans une table avec sa raison, et cette raison
est publiée sur la page comme une facette non couverte publie la sienne (`FR-144`).

**Une lacune dans le garde de copie de `L0`.** La raison de `M-14` s'affichait avec du
gras Markdown, des accents graves et un **tiret cadratin** — le tic même que `L0` a
retiré. Le garde ne lisait que `lib/strings.ts` ; la copie visible vient désormais aussi
d'artefacts générés. Étendu, et les deux nouveaux gardes vérifiés rouges.

### Ce que le rejeu montre, et ce qu'il ne montre pas

Les deux colonnes partagent leur première entrée — même décision, même outil, **même
empreinte d'arguments** — donc littéralement le même appel. Puis elles bifurquent, et un
filet cuivre marque le rang dans chacune.

Trois champs sont écartés, pour trois raisons différentes : `latency_ms`, parce que
`perf/overhead.json` refuse de publier une latence ; `tenant_id` et `user_id`, qui
n'apprennent rien ; `entry_hash` et `prev_hash`, parce que `payload_v1` hache
l'horodatage et l'identifiant de requête, si bien qu'ils changent à chaque exécution et
qu'aucun gate d'égalité ne pourrait les tenir. À leur place, la **propriété vérifiée** :
`core.audit.verify_chain` a confronté la chaîne au moment de la capture.

Aucune table de traduction des décisions n'est écrite. Le vocabulaire est ouvert, et une
correspondance figée côté page afficherait un jour un refus en gris. Le générateur
calcule le **point de divergence** : dérivé, il ne se périme pas.

---

## 5 octies. Ce que `L7` a livré

`L5` donnait déjà au visiteur son sous-ensemble de menaces. La question du lot était
donc : que peut ajouter « Pour qui » sans se répéter ?

La réponse était dans le moteur, inexploitée — **`activates_at`**. `L5` dit ce qui vous
concerne ; `L7` dit ce qui le **deviendrait**, et à quelle condition. Un visiteur `P1a`
lit huit lignes concrètes, chacune avec sa bascule : « Piratage d'agents autonomes →
bascule avec P3, agents outillés qui agissent ». C'est une date dans une feuille de
route, pas une plaquette — et c'est ce qui fait qu'un grand compte se reconnaît, bien
mieux qu'une liste de secteurs ou un mur de logos.

**Deux corrections nées de la relecture du rendu contre son propre titre.**

La section s'intitule « et, tout aussi clairement, pour qui ce n'est pas », mais
l'affirmation correspondante n'apparaissait que si le visiteur cochait `P1b`.
L'affirmation la plus crédible de la page était donc réservée à ceux qui avaient déjà
deviné. Elle est désormais **toujours affichée**, et se souligne quand elle devient le
cas du lecteur.

Un **seul** sélecteur pilote les deux sections. L'état est remonté dans un contexte
partagé, avec un seul appel au moteur. Deux sélecteurs auraient posé au visiteur une
question à laquelle il a déjà répondu, avec deux réponses possiblement divergentes : le
défaut que ce chantier combat depuis `L3`.

**Ce que les gardes tiennent.** Les profils que la page propose sont exactement ceux de
`core.profiles.Profile` — vérifié rouge en en retirant un, parce que le cas discret et
coûteux est celui du profil *tacite*, pas du profil de trop. Et le plafond publié est
celui que `FR-174` calcule : une liste écrite côté page contournerait le mécanisme qui
existe pour nous rendre incapables de dire que nous supervisons une IA embarquée SaaS.

**Le gate de `L4` a mordu une troisième fois** sur ma propre copie (« les deux
populations », dans une phrase contenant « matrice »). C'est précisément pourquoi il a
été écrit avant la page.

**Une erreur de méthode, commise deux fois avant d'être nommée** : `innerText` applique
`text-transform`, si bien que deux vérifications manuelles sur du texte en classe
`uppercase` ont conclu à tort que la page ne l'affichait pas. Les tests le disent
désormais, et sont insensibles à la casse.

---

## 5 nonies. Ce que `L8` a livré, et les deux affirmations sans preuve qu'il a retirées

`/executive-preview` affichait **des chiffres écrits à la main** : `governed: 8`,
`allow: 124`, `review: 37`, `block: 9`. Le tenant de démonstration réel en compte **5**
gouvernés et **93** autorisations. Les chiffres inventés **flattaient** — c'est ce que
fait toujours un chiffre inventé, sans que personne l'ait décidé, et c'est ce qui le
rend dangereux sur une page publique bien plus que son inexactitude.

Ils viennent désormais d'une **lecture réelle** : `tests/test_demo_snapshot.py` sème
`demo/seed.yaml` dans une base neuve pendant la suite, vérifie la chaîne d'audit, puis
relit — 109 entrées sur 11 jours, 5 outils gouvernés. La fixture est committée,
relisible, entièrement fabriquée, et un garde de CI vérifie avec les détecteurs du
produit qu'elle ne porte aucune forme de PII réelle (`AD-31`) : publier ce qu'elle
produit est sûr **par construction**, et vérifiable en lisant un diff.

Le bandeau dit ce que la page est : instantané daté, signé par un commit, lecture seule,
fixture fabriquée, chaîne vérifiée à la capture.

**La seconde affirmation retirée : le « 100 % de couverture d'audit ».** Écrit en dur, et
le commentaire du code le trahissait sans le vouloir — une « réassurance ». Il n'est pas
démontrable : un taux demande un dénominateur, et une action non journalisée ne laisse
par définition aucune trace pour le fournir. Remplacé par ce qui se prouve — le nombre
d'entrées enregistrées, et le fait que leur chaîne se vérifie. Faute des deux, la KPI ne
s'affiche plus du tout : une case vide vaut mieux qu'un chiffre que rien n'appuie.

### Deux écrans, pas quatre, et la raison est dans le sujet

Le §2.5 en annonçait quatre. Mesure faite, la fixture n'en alimente que deux honnêtement.
`usage_events` est vide, donc aucune dépense. L'inspecteur montrerait les mêmes appels
que l'explorateur. Et surtout la table `approvals` est vide — la fixture n'écrit aucune
demande.

**Il ne faut pas en fabriquer.** Dans un instantané figé et daté, une approbation « en
attente » se lit comme une demande à laquelle personne n'a jamais répondu, soit l'inverse
du mécanisme qu'on veut montrer. Une file d'approbation est vivante ou n'est pas. La
synthèse dirigeant et l'explorateur d'audit, eux, sont *nativement* de forme instantané :
ce sont des lectures d'un état à une date. La page publie donc les deux, et dit ce qui
manque avec sa raison.

### Une limite du gate de `L4`, déclarée plutôt que comblée de travers

Le « 100 % » a échappé au gate parce que **le chiffre et le mot de couverture vivaient
dans deux éléments différents** : la valeur en dur dans un objet, le libellé venant du
dictionnaire, à deux nœuds de distance. Élargir le motif pour les rapprocher signalerait
tout nombre voisinant un mot de couverture n'importe où dans un fichier — un garde à ce
taux-là est débranché dans la semaine, exactement l'arbitrage déjà tranché pour `un` et
`une`. Le trou est donc écrit dans le gate, à côté des trois autres qu'il déclare.

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
