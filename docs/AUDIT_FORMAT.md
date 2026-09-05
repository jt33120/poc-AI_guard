# Format du journal d'audit — charge canonique v1

> Ce document **fige** la représentation. Il ne la décrit pas : il la contraint.
> `tests/test_audit_format.py` compare le code à des vecteurs écrits ici en dur, donc
> une divergence entre ce fichier et `core/audit.py` est une CI rouge, pas une note à
> corriger un jour.

## Pourquoi ce fichier existe

`audit_log` est append-only par trigger, y compris pour `service_role` : aucune ligne
n'est jamais corrigée. La vérification d'une entrée consiste à **reconstruire ses
octets** à partir des colonnes stockées et à recalculer son `entry_hash`. Il s'ensuit
que la représentation n'est pas un détail d'implémentation — c'est une partie du
format de stockage.

Elle n'était tenue par rien. Quatre sites répétaient littéralement la même expression,
et toute la suite écrivait puis vérifiait dans le même processus : un changement
*cohérent* — normaliser `+00:00` en `Z`, ajouter `timespec="microseconds"`, changer
les `separators` de `json.dumps`, renommer une clé — restait invisible pour tous les
tests, pendant que **la chaîne déjà écrite devenait définitivement invérifiable**. Le
symptôme n'apparaît qu'en production, sur des lignes qu'on ne peut plus réparer.

## La chaîne

```
entry_hash = sha256( prev_hash + payload )
```

* `prev_hash` : l'`entry_hash` de l'entrée précédente **du même tenant**, ou la chaîne
  littérale `GENESIS` pour la première.
* `payload` : la charge canonique ci-dessous.
* Encodage avant hachage : UTF-8. Sortie : sha256 hexadécimal minuscule.
* Les écritures sont sérialisées par tenant (`pg_advisory_xact_lock`), donc deux
  entrées ne peuvent pas partager un `prev_hash`.

## La charge canonique v1

```python
json.dumps(event, sort_keys=True, separators=(",", ":"))
```

`sort_keys=True` et `separators=(",", ":")` font partie du format : un séparateur par
défaut (`", "`) produirait d'autres octets, donc d'autres hachages.

`event` porte **exactement douze clés**, ni plus ni moins :

| Clé | Type | Origine |
|---|---|---|
| `ts` | `string` | dérivé serveur (voir ci-dessous) |
| `tenant_id` | `string` | dérivé serveur |
| `user_id` | `string \| null` | dérivé serveur |
| `request_id` | `string \| null` | **dérivé serveur** — jamais l'identifiant fourni par l'agent |
| `tool_name` | `string \| null` | borné à 200 caractères (`FR-163`) |
| `action_class` | `string \| null` | vocabulaire clos |
| `decision` | `string` | vocabulaire clos |
| `policy_rule_id` | `string \| null` | borné à 200 caractères |
| `judge_used` | `boolean` | dérivé serveur |
| `args_hash` | `string \| null` | sha256 des arguments, jamais leur contenu (§4.10) |
| `latency_ms` | `integer \| null` | dérivé serveur |
| `error` | `string \| null` | borné à 200 caractères |

Ajouter, retirer ou renommer une clé change la charge de **toutes** les entrées
futures et rend les précédentes invérifiables par le nouveau code. Une évolution du
format se fait par une charge `v2` et un vérificateur qui sait lire les deux, jamais
par une modification de `payload_v1`.

## La représentation de l'horodatage

```python
ts.astimezone(UTC).isoformat()
```

Deux propriétés à connaître, parce qu'elles surprennent :

* le suffixe est **toujours `+00:00`**, jamais `Z` ;
* la partie fractionnaire est **absente quand les microsecondes valent zéro**, et
  présente sur six chiffres sinon. La longueur de la chaîne n'est donc pas constante.

```
2026-01-02T03:04:05+00:00           (microseconde = 0)
2026-01-02T03:04:05.123456+00:00    (microseconde ≠ 0)
```

Un horodatage naïf (sans fuseau) est **refusé** plutôt que supposé UTC : supposer
produit une entrée fausse et vérifiable, ce qui est le pire des deux mondes.

Toute ré-sérialisation JSON qui normaliserait en `Z`, tronquerait la précision, ou
ferait transiter la valeur par un champ `datetime` Pydantic changerait ces octets.
L'export porte donc `ts` comme la **chaîne brute**, jamais comme une date typée.

## Ce qui est hors de la charge

Les colonnes annexes d'`audit_log` ne sont **pas** hachées, et c'est délibéré
(`FR-161` / `AD-1`) : elles ont pu être ajoutées sans invalider les entrées
existantes, et elles ne sont pas attestées par la chaîne non plus.

| Colonne | Nature |
|---|---|
| `gateway_token_id` | dérivé serveur — quel agent |
| `client_request_id` | **déclaré par l'agent** |
| `upstream_request_id` | **déclaré par le fournisseur LLM** |
| `ingress` | dérivé serveur — par quelle porte |
| `enforcement_mode` | dérivé serveur — `enforcing` / `observing` |

La distinction déclaré/dérivé est le sujet de `FR-161` : une valeur qu'un tiers
choisit ne peut pas servir de preuve, donc elle est stockée à côté de la preuve et
non dedans.

## Où c'est implémenté

* `core/audit.py` — `canonical_ts`, `payload_v1`, `compute_entry_hash`, `verify_chain`.
* `tests/test_audit_format.py` — les vecteurs dorés, écrits en dur.
* `docs/SPEC.md` §9 — la formule, dont ce fichier est le détail normatif.
