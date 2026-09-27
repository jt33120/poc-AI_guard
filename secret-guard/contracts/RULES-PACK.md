# Contrat « Règles sur mesure xSOM » (rules pack v1)

Ce contrat lie les deux produits. **La plateforme AI Guard** compose, valide, signe et distribue
un paquet de règles propre à un client ; **Secret Guard** (runner, extension) le vérifie hors ligne
et l'applique localement, sans réseau ni LLM sur le chemin de détection. Le réglage est une
prestation xSOM : aucune case à cocher côté client ne crée de règle.

Sources normatives, dans cet ordre : ce document, `rules-pack.schema.json`,
`fixtures/rules-pack-vectors.json`. Toute implémentation (TypeScript du poste, Python de la
plateforme) doit reproduire **tous** les vecteurs à l'identique. Le contrat est figé en v1 :
une évolution change `schemaVersion` et ajoute des vecteurs, elle ne modifie pas les existants.

## 1. Forme transportée

```json
{ "payload": { …paquet… }, "keyId": "<sha256 hex de la clé publique brute>", "signature": "<base64 Ed25519>" }
```

- **Forme canonique** de `payload` : JSON UTF-8, clés d'objet triées, aucun espace, caractères
  non ASCII écrits tels quels (équivalent exact de `JSON.stringify` à clés triées côté
  TypeScript et de `json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)` côté
  Python). Aucun nombre à virgule n'existe dans le paquet ; c'est voulu.
- **Signature** : Ed25519 sur les octets de la forme canonique.
- **`keyId`** : SHA-256 hexadécimal de la clé publique Ed25519 brute (32 octets).
- **Empreinte du paquet** (`payloadDigest`) : SHA-256 hexadécimal de la forme canonique. C'est
  l'identité rapportée par le poste dans sa posture.

Le poste **n'accepte jamais une clé fournie par l'enveloppe** : il cherche `keyId` dans la liste
des clés d'autorité xSOM intégrées à sa build (plusieurs clés possibles pour la rotation). Une
build sans clé d'autorité refuse tout paquet. C'est ce qui rend le réglage non contrefaisable :
seul xSOM peut produire un paquet que l'extension officielle accepte.

## 2. Validité d'un paquet

Un paquet est valide si et seulement si, dans cet ordre :

1. il respecte `rules-pack.schema.json` ;
2. les `id` de détecteurs sont uniques (`duplicate_detector`) ;
3. `expiresAt` est strictement postérieur à `issuedAt` (`validity_window`), comparaison des
   chaînes ISO `YYYY-MM-DDTHH:MM:SSZ` ;
4. le total des empreintes de tous les détecteurs `terms` est ≤ 20 000 (`too_many_digests`) ;
5. chaque motif est valide selon §3, compte tenu de la présence de `context` (`invalid_pattern`) ;
6. chaque test positif nomme un détecteur existant (`unknown_test_detector`) ;
7. chaque détecteur `pattern` a au moins un test positif (`missing_positive`). Un détecteur
   `terms` n'en exige pas : un positif révélerait un terme confidentiel en clair ;
8. chaque positif produit au moins une détection de **son** détecteur (`positive_not_detected`) ;
9. aucun négatif ne produit de détection d'**aucun** détecteur du paquet (`negative_detected`).

La plateforme refuse de signer un paquet invalide ; le poste refuse de charger un paquet
invalide même correctement signé. Un paquet ne fait qu'**ajouter** des détections : il ne
désactive, n'affaiblit ni ne remplace aucune règle intégrée.

## 3. Grammaire des motifs (`match.type = "pattern"`)

Sous-ensemble sûr d'expressions régulières, en ASCII imprimable (0x20–0x7E) uniquement,
256 caractères au plus.

```
motif       := alternative ('|' alternative)*
alternative := terme+                      (vide interdit : empty_alternative)
terme       := atome quantificateur?
atome       := littéral | échappement | classe | groupe
groupe      := '(?:' motif ')'             (profondeur de groupes ≤ 4 : too_deep)
classe      := '[' élément+ ']'            (vide : empty_class ; '[^' : negated_class)
élément     := car ('-' car)? | '\d' | '\w' | '\s'
quantificateur := '?' | '{' n '}' | '{' n ',' m '}'
n, m        := 0 | [1-9][0-9]{0,2}         avec 1 ≤ m ≤ 64, n ≤ m ; '{n}' exige n ≥ 1
```

- **Littéral** : tout caractère ASCII imprimable sauf `\ ^ $ . | ? * + ( ) [ ] { }`.
- **Échappement** : `\` suivi de l'un de `\ ^ $ . | ? * + ( ) [ ] { } - /` (littéral), ou
  `\d` = `[0-9]`, `\w` = `[A-Za-z0-9_]`, `\s` = `[ \t\n\r\f\v]`. Ces classes sont **ASCII
  uniquement** : une implémentation doit les développer en classes explicites (en JavaScript,
  `\s` natif accepte l'espace insécable ; c'est faux ici). Tout autre échappement est refusé
  (`bad_escape` : `\b`, `\n`, `\x41`, `\1`, `\D`, `\p{…}`…).
- **Dans une classe** : `[`, `-` et `^` doivent être échappés, sauf `-` entre deux bornes d'un
  intervalle (`bad_class_char`) ; un intervalle croissant (`bad_range`) ; les autres
  métacaractères y sont littéraux.
- **Interdits** : `.` (`dot_not_allowed`), `^`/`$` (`anchor_not_allowed`), groupes capturants,
  nommés ou assertions (`group_not_allowed`), `*`, `+`, `{n,}` (`unbounded_quantifier`),
  quantificateur sans atome (`dangling_quantifier`) ou suivi d'un autre, y compris paresseux
  (`stacked_quantifier`), borne hors limites ou mal écrite (`bad_quantifier`), classe ou groupe
  non fermés (`unbalanced_class`, `unbalanced_group`), `]` ou `}` isolés (`bad_literal`),
  caractère hors ASCII imprimable
  (`invalid_character`), longueur (`length`).
- **Répétition imbriquée** : un groupe quantifié avec une borne haute > 1 ne peut contenir ni
  quantificateur ni alternative (`nested_repetition`). `(?:…)?` peut en contenir.
- **Longueurs** : longueur minimale d'une correspondance ≥ 3 (`too_short`), maximale ≤ 256
  (`too_long`), calculées sur l'arbre.
- **Ancre** : le motif doit contenir, au premier niveau (hors groupe, hors alternative), une
  suite d'au moins 3 littéraux consécutifs non quantifiés ; sinon le détecteur doit porter un
  `context` (`no_anchor`). Cette ancre ou les mots-clés du contexte permettent au poste de
  préfiltrer le texte par recherche littérale.

Ordre des contrôles, pour les codes d'erreur : longueur et caractères, puis syntaxe de gauche à
droite (dont `nested_repetition` au moment où le quantificateur du groupe est lu), puis
`too_short`, `too_long`, `no_anchor`. Chaque vecteur invalide ne comporte qu'un seul défaut.

## 4. Sémantique de détection

Une détection est une sous-chaîne du texte. Les vecteurs donnent les sous-chaînes attendues,
dans l'ordre du texte ; les positions ne sont pas contractuelles (UTF-16 d'un côté, points de
code de l'autre).

**`pattern`** — toutes les correspondances **les plus à gauche, premier choix d'abord** (sémantique
à retour arrière ECMAScript/Python, pas « la plus longue »), sans chevauchement, parcourues sur
tout le texte : ce que rendent `matchAll` (sans drapeau `u`) et `re.finditer` (avec `re.ASCII`).
`caseInsensitive` ne replie que les lettres ASCII. Puis, pour chaque correspondance :

- si `minEntropyTenths` est présent, elle est gardée si son entropie de Shannon, en bits par
  caractère, est ≥ `minEntropyTenths / 10` ;
- si `context` est présent, elle est gardée si l'un des mots-clés apparaît, en comparaison
  insensible à la casse ASCII seulement, **entièrement** dans la fenêtre
  `[début − window, fin + window)`, bornée au texte, comptée en **points de code**.

**`terms`** — le paquet ne contient que des empreintes, jamais les termes :

- un **mot** est une suite maximale de points de code de catégorie Unicode L, N ou M ; tout
  autre caractère (espace, ponctuation, `_`, `-`…) sépare ;
- **normalisation d'un mot** : NFKD, suppression des marques (catégorie M), minuscules Unicode
  par défaut (`toLowerCase` / `str.lower`) ; un mot devenu vide est ignoré ;
- pour chaque mot et chaque longueur `k` de 1 à `maxWords`, le n-gramme est la jonction par une
  espace des `k` mots normalisés consécutifs ; il correspond si
  `hex(SHA-256(sel ‖ UTF-8(n-gramme)))` figure dans `digests` (`sel` = octets décodés de `salt`) ;
- candidats filtrés par `context` s'il existe, puis triés par début croissant et, à début égal,
  par longueur décroissante ; on retient chaque candidat qui ne chevauche pas le précédent retenu.

L'empreinte d'un terme saisi par l'opérateur est calculée sur sa forme normalisée (mots
normalisés joints par une espace) : `terms.cases` des vecteurs le montre.

## 5. Obligations propres au poste (Secret Guard)

- Vérifier la signature avec une clé d'autorité intégrée, puis la validité (§2) avant tout usage ;
  refuser un paquet dont `tenantId` diffère du tenant enrôlé.
- Anti-retour : ne jamais accepter une `version` inférieure à la plus haute déjà acceptée pour
  le même `packId`.
- Un paquet expiré reste appliqué (il n'ajoute que des protections) mais la posture le signale ;
  un paquet refusé ou absent laisse les règles intégrées intactes.
- Temps borné : le préfiltre littéral et un budget de travail par analyse sont obligatoires ;
  un budget dépassé donne un **blocage explicite** (analyse incomplète), jamais un passage.
- Ne jamais journaliser ni renvoyer la valeur détectée ; l'étiquette (`label`) et l'`id` du
  détecteur suffisent à l'interface et à l'audit.

## 6. Obligations propres à la plateforme (AI Guard)

- Seul un opérateur xSOM compose et signe ; un administrateur client lit son réglage, ne le
  modifie pas. La clé privée vient de l'environnement (`XSOM_RULES_SIGNING_KEY`, graine
  Ed25519 base64), jamais du dépôt ni des journaux.
- Les termes confidentiels saisis en clair servent au calcul des empreintes et à la vérification
  qu'ils sont tous détectés, puis sont oubliés : ni stockés, ni journalisés.
- Versions strictement croissantes par `(tenantId, packId)`, historique en ajout seul, chaque
  publication tracée dans l'audit hash-chaîné (métadonnées et empreinte, pas de contenu).

## 7. Distribution et posture

- `GET /v1/extension/rules-pack`, même authentification poste que `/v1/extension/policy` :
  `200 {"rulesPack": <enveloppe>}` ou `200 {"rulesPack": null}` quand le tenant n'a pas de
  réglage ; erreurs identiques à la route de politique.
- Événements poste (`core/extension_devices.py`, `Event`) : nouveau `kind`
  `"rules_pack_synced"` ; champs optionnels `rules_pack_id` (motif de `packId`),
  `rules_pack_version` (entier ≥ 1), `rules_pack_digest` (`^[0-9a-f]{64}$`),
  `custom_findings` (0 à 10 000) et `custom_detector_ids` (au plus 20 `id` de détecteurs,
  uniques) ; nouvelles raisons de posture `"rules_pack_rejected"` et `"rules_pack_expired"`.
  Aucun contenu, aucune valeur détectée.
