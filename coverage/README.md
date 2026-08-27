# Couverture — le registre et sa garde

Deux fichiers, et la distinction entre eux est tout le mécanisme :

| | |
|---|---|
| `rows.yaml` | **Rédigé.** Ce que nous *revendiquons* : 16 menaces, 24 facettes, leur mode et leur chemin d'ingestion. |
| `COVERAGE-MAP.md` · `map.json` | **Générés, jamais rédigés** (`AD-30`). Ce qui est *prouvé*. Non committés — ce sont des sorties de build. |

`scripts/gen_coverage.py` confronte les deux. L'écart entre revendiqué et prouvé est
`CM-7`, dont la cible est **zéro**.

## La règle dure

> Une facette revendiquée `Bloqué` sans scénario qui passe **fait échouer le build.**

Ce n'est pas une préférence de rédaction. Une revendication « Bloqué » qu'aucun test
n'asserte est une affirmation fausse au sujet d'un contrôle de sécurité — sur un
produit vendu sur la preuve, c'est le pire endroit où être approximatif.

Les autres modes n'exigent pas de scénario. Mais s'il en existe un, il est enregistré.

## La deuxième règle : le mode publié n'est jamais plus fort que la preuve

Une facette est publiée `Bloqué` **uniquement sur les chemins d'ingestion réellement
prouvés** (`AD-28`). Un chemin revendiqué mais non asserté est rendu `non asserté`,
jamais `Bloqué`. Une garantie vraie sur MCP se lirait comme vraie partout si la carte
ne le disait pas.

## La troisième règle : une revendication `Bloqué` doit prouver les deux moitiés

> Une facette `Bloqué` a besoin d'un scénario qui **bloque** *et* d'un scénario qui
> **laisse passer** un appel légitime.

Une garde qui refuse tout n'est pas un contrôle, c'est une panne — et le scénario
bloquant reste vert sur un gateway qui bloque aveuglément. Prouver le refus sans
prouver la discrimination prouve la mauvaise chose.

C'est la forme mécaniquement vérifiable de « chaque scénario porte son contrôle
négatif ». On ne peut pas outiller « l'assertion est-elle sérieuse » ; on peut
outiller « les deux sens sont-ils prouvés ».

## Écrire un scénario

Un scénario est un test de garde qui porte le marqueur de la facette qu'il prouve, et
le **sens** qu'il établit :

```python
@pytest.mark.covers("M-07", "emission", ingress="mcp", sens="bloque")
async def test_send_outside_the_allowlist_is_denied_and_never_relayed(db): ...

@pytest.mark.covers("M-07", "emission", ingress="mcp", sens="laisse_passer")
async def test_send_inside_the_allowlist_still_goes_through(db): ...
```

Un test qui asserte réellement les deux moitiés porte les deux marqueurs — c'est le
cas de `M-08` (retenu après un approbateur, relâché après deux distincts) et de
`M-14` (la décision *est* enregistrée, le secret ne l'est pas). Empiler les deux
marqueurs sur un test qui n'en établit qu'un est le défaut que ce mécanisme existe
pour trouver : il s'est produit une fois pendant l'écriture, en marquant en masse.

Trois exigences, apprises en écrivant les premiers :

1. **Un contrôle négatif.** « Un refus a été signalé » ne prouve rien. Ce qui compte
   est que l'outil en aval n'a jamais tourné — `proxy.calls`, `"deleted" not in ...`.
   Cette exigence-là reste une discipline de revue : aucun outil ne juge le sérieux
   d'une assertion.
2. **Le bon sens déclaré.** Voir la troisième règle ci-dessus. Celle-ci est outillée.
3. **Le bon chemin d'ingestion.** Un marqueur déclarant un `ingress` absent de la
   revendication est rejeté — la preuve est réelle, mais pas pour cette revendication.

Un marqueur nommant une facette inexistante fait échouer le build, comme une clé de
contrainte inconnue (`AD-36`) : la même doctrine, un cran plus haut.

## Lancer

```bash
uv run pytest                                 # écrit coverage/.scenarios.json
uv run python scripts/gen_coverage.py --check # la garde CM-7 (aussi : make coverage-gate)
uv run python scripts/gen_coverage.py         # écrit la carte  (aussi : make coverage-map)
```

La garde tourne en CI après pytest, et dans `make verify`.

## Ce que la garde ne fait pas encore

- Elle ne publie pas la carte sur le site : le fragment de la page publique
  (`blueprint/06-page-publique/`) se copie encore à la main par une PR.
- Elle ne juge pas la **qualité** d'une assertion. Un scénario `bloque` qui vérifie
  seulement qu'une erreur a été renvoyée, sans vérifier que l'outil en aval n'a pas
  tourné, passe la garde. Les deux sens sont outillés ; le contrôle négatif à
  l'intérieur de chaque sens ne l'est pas.
