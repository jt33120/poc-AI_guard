# `G-26` — le streaming du proxy LLM : note de décision

> **Statut : tranché — `B` retenue et livrée, `C` reportée à son déclencheur.**
> Ce document a instruit le dossier ; la décision est prise et consignée en §6.
> **Audience** : le propriétaire produit.
> Sources vérifiées : `api/llm_proxy.py` `_forward`, `coverage/rows.yaml`, `AD-35`.

---

## 1. Ce que le défaut est, et ce qu'il n'est pas

La branche streaming renvoie les octets amont bruts et retourne **avant** `_inspect` :

```python
if streaming:
    upstream_resp = await client.send(upstream_req, stream=True)
    return StreamingResponse(upstream_resp.aiter_raw(), ...)
```

Avec `stream: true` — le défaut de la plupart des frameworks d'agents — aucun appel
d'outil n'est examiné et **aucune ligne d'audit n'est écrite**.

**Ce n'est pas une revendication fausse.** `coverage/rows.yaml` ne revendique
`llm_proxy` que pour `M-10 / egress`. Le contrôle d'appels d'outils (`M-06`, `M-12`)
est revendiqué sur `mcp` uniquement, et la garde `CM-7` refuserait une revendication
sans scénario. Sous `AD-35`, c'est l'état sanctionné : *une entrée manquante est un
manque de capacité déclaré, pas un filtre sauté en silence.*

**La DLP d'egress, elle, couvre le streaming** : le blocage est en amont de la branche.
`M-10` n'est pas concerné.

**Ce qui reste réellement problématique est plus étroit, et invisible :** un client qui
streame n'obtient **aucune trace** de ce que le modèle a demandé. L'absence de
couverture est déclarée dans la carte ; l'absence de *trace*, elle, ne se voit nulle
part. Rien ne dit à l'exploitant « cette session a été streamée, donc non observée ».

---

## 2. Correction d'un cadrage que j'ai donné trop vite

J'ai présenté l'arbitrage comme **latence contre couverture**, en supposant qu'il
fallait bufferiser tout le flux. C'est faux, et la nuance change la décision.

Dans les deux protocoles concernés, le texte et les appels d'outils arrivent en
**deltas distincts** — `delta.content` contre `delta.tool_calls` chez OpenAI,
`content_block` de type `text` contre `tool_use` chez Anthropic. Un proxy peut donc
**relayer le texte en direct et ne retenir que les deltas d'appels d'outils**, en
décidant à la fin du bloc.

Le temps jusqu'au premier octet est alors préservé pour la partie conversationnelle ;
seule la partie *actionnable* est retardée — et elle n'est pas ce qu'un humain lit en
attendant. L'arbitrage n'est pas « rapide ou contrôlé ».

*Réserve honnête :* je n'ai pas prototypé ce découpage. Il est cohérent avec les deux
protocoles, mais son coût réel (robustesse du parsing SSE, deltas partiels, erreurs en
milieu de flux) demande une maquette avant d'être promis.

---

## 3. Les options, avec ce que chacune coûte

| | Option | Coût | Ce qu'on gagne | Ce qu'on ne gagne pas |
|---|---|---|---|---|
| **A** | **Ne rien faire.** La carte ne revendique déjà rien sur ce chemin. | 0 | Rien à construire | L'absence de trace reste invisible ; un évaluateur qui le trouve seul le lira comme une omission, pas comme un choix |
| **B** | **Rendre l'absence visible.** Une ligne d'audit par complétion streamée : « streamé, non inspecté », métadonnées seules. | Une écriture par requête, hors chemin de réponse — latence ~0 | L'angle mort devient *auditable* : la console peut dire « N % du trafic de cet agent n'a pas été observé ». Un écart déclaré vaut mieux qu'un écart déduit | Aucun contrôle supplémentaire |
| **C** | **Couvrir vraiment**, en ne retenant que les deltas d'outils. | Parsing SSE des deux protocoles + maquette. Latence sur les seuls appels d'outils | `M-06`/`M-12` deviennent revendicables sur `llm_proxy` — sous réserve d'un scénario, `CM-7` y veille | Rien de gratuit : c'est le plus gros des trois |
| **D** | **Refuser le streaming** quand la policy contient des outils non-`auto`. | Faible | Cohérent avec le fail-closed | Casse l'usage le plus courant. Un contrôle qui rend le produit inutilisable n'est pas retenu |

---

## 4. Ce que je recommande

**B maintenant, C quand la couverture du proxy devient un argument de vente.**

`B` coûte presque rien et corrige ce qui est réellement défendable dans la critique :
non pas que nous ne bloquions pas — nous ne l'avons jamais prétendu — mais que le
silence soit indiscernable d'une absence de trafic. C'est la même doctrine que la
carte de couverture : **publier ce qu'on ne couvre pas est le contrôle qualité de ce
qu'on couvre.**

`C` est un vrai travail et n'a d'intérêt qu'au moment où l'on veut *revendiquer* le
contrôle d'appels d'outils sur ce chemin. Tant que le gateway MCP porte cette
revendication, la valeur marginale est faible — et `CM-7` interdit de la revendiquer
sans le scénario qui va avec, donc le raccourci n'existe pas.

`A` n'est pas déraisonnable si la priorité est ailleurs : rien dans la carte ne devient
faux. C'est un choix de calendrier, pas un compromis sur l'honnêteté.

---

## 5. Ce qu'il faut décider

1. **B, oui ou non ?** Si oui, c'est un lot de rang 8 (intégrité de la preuve, non
   bloquant pour la démonstration).
2. **C, à quel déclencheur ?** Ma proposition : quand un client de profil `P3`
   (agents outillés) route son trafic par le proxy plutôt que par le gateway MCP.
   Avant ça, l'effort sert une revendication que personne ne demande.

---

## 6. La décision, et un écart d'implémentation assumé

**`B` est retenue et livrée** : une ligne `streamed_uninspected` par complétion
streamée, métadonnées seules. **`C` est reportée** au déclencheur proposé en §5 — un
client de profil `P3` qui route son trafic d'agents par le proxy plutôt que par le
gateway MCP.

**Un écart avec §3, à voir en revue.** Le tableau annonçait « une écriture par requête,
**hors chemin de réponse** — latence ~0 », c'est-à-dire dans la tâche de fermeture du
flux. En construisant, l'ordre s'est avéré porter la question : une ligne écrite après
la fin du flux **manque exactement pour les sessions interrompues en cours de route**,
qui sont celles qu'un auditeur regarde en premier. Une métrique « N % du trafic non
observé » qui perd ses cas d'échec est fausse dans le sens qui arrange.

La ligne est donc écrite **avant** le relais. Le fait « cette requête est streamée, donc
non inspectée » est connu à ce moment, avant qu'aucun octet ne circule, et le coût est
un `insert` devant un appel de modèle qui dure des centaines de millisecondes. Le
« latence ~0 » de §3 devient « latence négligeable » — l'écart est petit, mais il a été
choisi plutôt que subi.

**Ce que `B` ne fait pas**, et il faut le redire ici : aucun contrôle supplémentaire.
Un appel d'outil demandé en flux n'est toujours pas examiné. `CM-7` interdit de le
revendiquer, et le registre continue de ne revendiquer `llm_proxy` que pour
`M-10 / egress` — dont la borne est désormais assertée par un test plutôt que déduite
de la lecture du code.
