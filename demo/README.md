# Le tenant de démonstration

`seed.yaml` est le tenant que la démonstration montre : **formes de données
réalistes, contenu entièrement fabriqué** (`FR-182`).

```
DATABASE_URL=... uv run python scripts/seed_demo.py     # ou : make seed-demo
```

## Pourquoi une fixture committée plutôt qu'un générateur

`AD-31` : « aucune donnée personnelle de tiers » doit se vérifier **en lisant le
diff**. Un tenant produit par un générateur ne se relit pas — il faut faire
confiance au générateur, et la confiance est exactement ce qu'un produit vendu sur
la gouvernance des données ne demande pas.

Le domaine — appariement consultants / appels d'offres — est celui du cabinet,
parce que c'est la forme la plus proche du métier et donc la plus crédible à
raconter (`QO-9`). Les noms, sociétés et références sont inventés.

## Ce que le garde de CI vérifie

`tests/test_demo_seed.py` passe **les détecteurs du produit lui-même**
(`core/dlp.py`) sur chaque valeur de la fixture. Pas une seconde série de motifs :
deux jeux de règles divergent, et le jour où ils divergent, le produit détecte chez
un client ce qu'il tolère dans sa propre vitrine.

| Interdit | Pourquoi |
|---|---|
| IBAN, numéro de sécurité sociale, carte bancaire | Ils portent une somme de contrôle. Une valeur qui la passe n'a pas été fabriquée par distraction — c'est une vraie donnée qui a glissé. |
| Numéro de téléphone | La fixture n'en a pas besoin ; l'interdire sans exception évite d'avoir à raisonner sur des plages réservées. |
| Adresse hors RFC 2606 | Une adresse ailleurs qu'en `example.*` / `.invalid` / `.test` appartient à quelqu'un. |

## L'historique daté, et le garde qui le rend acceptable

`FR-183` demande un **historique accumulé** — dix jours, pour que la supervision
continue se lise comme une série et non comme un pic au chargement. Écrire des
entrées datées dans le passé signifie choisir `ts`, un champ **dans la charge
hachée**.

Ce n'est pas un pouvoir nouveau : `audit_log.ts` a toujours été l'horloge de celui
qui écrit, et la chaîne atteste qu'une ligne n'a pas été modifiée *depuis*, jamais
que l'écrivain a dit vrai sur le quand. Ce qui serait nouveau, c'est de rendre ce
choix atteignable depuis un adaptateur. D'où quatre gardes :

1. le semeur vit dans `scripts/`, et un test vérifie qu'aucun module de `core/`,
   `api/` ou `gateway/` ne l'importe ;
2. il refuse de tourner quand `ENV=prod` ;
3. il refuse un tenant qui porte déjà des entrées d'audit ;
4. il construit la charge avec `audit.payload_v1` — les mêmes octets que
   `log_event` — puis **vérifie la chaîne** avant de rendre la main. La fixture
   n'est pas écrite *à côté* du contrôle d'intégrité, elle le satisfait.
