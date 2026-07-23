# BUILD_PLAN_V1.1.md — xSOM AI Guard (post-MVP : A → B → C → D)

> Suite de `docs/BUILD_PLAN.md` (MVP M0→M8 livré). Ces milestones **approfondissent la thèse** (contrôler ce que l'agent *fait*), ils ne l'élargissent pas vers l'observabilité commoditisée. Même règle : un milestone n'est terminé que si ses **critères d'acceptation** passent et `make verify` est vert. Commit atomique à la fin de chaque sous-tâche.
>
> Ordre imposé : **M9 (A) → M10 (B) → M11 (C) → M12 (D)**. M9 en premier car il est daté par la réglementation (EU AI Act, art. 12/14/26 applicables le 2 août 2026) et ne fait qu'emballer ce qu'on a déjà.

---

## Invariants transverses (valables sur M9→M12)

Rappel des règles NON négociables (`CLAUDE.md §4`) qui contraignent *chaque* milestone :

- **Audit immuable** : tout nouveau champ d'audit = **colonne annexe** (hors `_payload` du hash-chain), exactement comme `gateway_token_id` l'a été (`core/audit.py:115`). Les entrées existantes doivent continuer à passer `verify_chain`. De nouvelles **valeurs** de `decision` (ex. `notify`, `tool_drift`, `tainted_action`) sont autorisées (elles n'affectent que les nouvelles entrées).
- **Fail-closed** partout : inconnu / service indisponible / doute → deny sur l'irréversible.
- **Zéro nouvelle dépendance** : tout se fait avec la stack actuelle (Python stdlib, `pyyaml`, `core/dlp.py`, `core/pricing.py`, `core/audit.py`). Toute dépendance nouvelle exige une justification dans le PR.
- **Jamais de contenu** : métadonnées + hash uniquement (`§4.10`). On ne loggue jamais un argument sensible ni le corps d'un résultat d'outil.
- **Rétrocompat** : toute nouvelle branche de policy est **opt-in** (`off` par défaut), sur le modèle de `defaults.auto_classify`.
- **Tests par module** (≥ 70 % sur la logique métier) + `make verify` vert avant commit.

---

## M9 — (A) Plan de conformité EU AI Act
**But** : transformer l'audit hash-chaîné + le HITL déjà en place en un **artefact de conformité** exportable et attestable — art. 12 (journalisation inviolable ≥ 6 mois), art. 14 (surveillance humaine), art. 26 (obligations du déployeur). Effort faible, valeur d'achat maximale : on emballe l'existant.

**Livrables**
- `core/compliance.py` : mapping déterministe `decision → article` (les `hitl_*` couvrent l'art. 14 ; l'intégrité de chaîne couvre l'art. 12 ; l'agrégat déployeur couvre l'art. 26) + calcul d'un **statut de conformité** (chaîne intacte ? rétention ≥ 183 j ? couverture d'oversight = % d'actions irréversibles passées par un humain ?).
- Extension `core/export.py` : nouveau `format=eu_ai_act` → **evidence pack** (JSON + PDF) = preuve `verify_chain` (art. 12) + liste horodatée des interventions humaines (art. 14) + résumé déployeur (art. 26). Le narratif PDF réutilise le juge (`core/judge.py`), déjà câblé pour les exports.
- **Garde de rétention** : config `audit_retention_days` (défaut ≥ 183). Toute purge/rotation d'`audit_log` sous ce plancher est **refusée** (fail-closed) — cohérent avec l'append-only.
- `scripts/verify_chain.py` : ajouter une sortie « attestation » signée-hash (chaîne intacte, N entrées, période couverte, rétention OK) réutilisable en CI et dans le pack.
- Squelette **FRIA** (Fundamental Rights Impact Assessment) pré-rempli avec les stats du tenant.
- API : `GET /v1/audit/export?format=eu_ai_act` ; `GET /v1/compliance/status`.

**Acceptation**
- L'export `eu_ai_act` produit un pack contenant : preuve d'intégrité de chaîne (art. 12), interventions humaines horodatées (art. 14), résumé déployeur (art. 26).
- Purger une entrée d'audit sous la rétention minimale → **refusé**.
- `GET /v1/compliance/status` passe **non-vert** si la chaîne est cassée ou la couverture d'oversight incomplète.
- `verify_chain` reste vert sur les entrées existantes (nouveaux champs = annexes).

---

## M10 — (B) Bouclier supply-chain MCP au proxy
**But** : faire du proxy le point qui **détecte le tool poisoning / rug-pull**, impose un **RBAC par outil** et **met en quarantaine** (fail-closed) tout outil inconnu ou modifié. C'est le *moat* : personne hors du chemin d'exécution MCP ne peut le faire.

**Livrables**
- Migration `tool_fingerprints` (`tenant_id, server, tool_name, desc_hash, schema_hash, first_seen, last_seen, approved`).
- `gateway/integrity.py` : à chaque `DownstreamProxy.list_tools()` (`gateway/downstream.py:90`), calculer `sha256(description ‖ inputSchema)` par outil et comparer au fingerprint approuvé :
  - outil **modifié** (desc/schéma changé après approbation) → **quarantaine** (non exposé, call refusé) + audit `tool_drift` ;
  - outil **jamais vu** → `pending_review` (auto-approuvé seulement si la policy l'autorise) ;
  - description contenant un **pattern d'injection** (`ignore previous`, instructions cachées, unicode invisible, URL d'exfiltration) → `poison_suspected` + quarantaine.
- **RBAC par outil** : étendre la policy pour scoper un outil par `client_id`/agent (réutilise le lien `gateway_tokens.client_id`). Agent hors scope → deny + audit.
- **Garde « confused deputy »** : un agent à faible privilège qui invoque un outil marqué `privileged` (classe `irreversible`) → escalade HITL ou deny.
- API : `GET /v1/tools/integrity` (fingerprints + statut) ; `POST /v1/tools/{name}/approve` (ré-approuver après drift) ; extension policy tool-RBAC.
- Fixture : étendre `tests/fixtures/mock_mcp_server.py` avec une variante « poisoned » (description qui change entre deux `list_tools`).

**Acceptation**
- Un outil dont la description change entre deux `list_tools` → **quarantaine**, non exposé, event `tool_drift` audité.
- Une description avec pattern d'injection → `poison_suspected`, refusé.
- Un agent hors scope RBAC → deny audité.
- Outil inconnu → fail-closed (déjà l'ADN, on le formalise).

---

## M11 — (C) Autonomie graduée & méritée
**But** : réduire la saturation du HITL et rendre l'autonomie **bornée mais méritée** — passer de 3 à **4 niveaux** (ajout de `notify` = *notify-and-proceed*) et introduire un **score de risque déterministe** par action. Aucun LLM sur le hot path.

**Livrables**
- Enum `Approval` (`core/policy.py:29`) : ajouter `notify` entre `auto` et `human_in_the_loop`. Sémantique : **relayer** l'action **mais** l'auditer + notifier en temps réel (pas de blocage). Câblage dans `core/decision.py` et le gateway. Mettre à jour `_APPROVAL_ORDER`.
- `core/risk.py` : `risk_score(tool, action_class, arguments, history) -> 0..100` déterministe, à partir de : **réversibilité** (classe d'action), **blast radius** (nb destinataires / wildcard / volume), **sensibilité des données** (réutilise `core/dlp.py` pour détecter PII/secret dans les args → contribue au score), **nouveauté** (couple (agent, outil) jamais vu dans `audit_log`).
- Policy : `defaults.risk_bands` (ex. 0-30 `auto`, 30-60 `notify`, 60-85 `human_in_the_loop`, 85+ `deny`), **opt-in** (off par défaut, comme `auto_classify`). **Plancher** : `irreversible` ne peut jamais tomber en `auto`, quel que soit le score.
- **Trust-earned** : si un couple (agent, outil) cumule N décisions `approved` consécutives sans `deny` (lu dans `audit_log`), le score baisse d'un cran — auto-relax **borné**, jamais sous le plancher. Déterministe.
- API : exposer `risk_score` + bande dans `/v1/authorize` et `/v1/tools` ; `GET /v1/agents/{id}/trust`.

**Acceptation**
- Read + args propres → `auto` ; write en bande `notify` → relayé + notifié + audité, **sans** blocage ; args contenant PII/secret → score monte → `human_in_the_loop` ; action très risquée → `deny`.
- `irreversible` jamais `auto`, même à score bas (test du plancher).
- Trust-earned abaisse le niveau après N approbations, borné (test).
- Tout déterministe (aucun appel juge sur le hot path).

---

## M12 — (D) Anti-injection indirecte au bord de l'action
**But** : gater les actions irréversibles **déclenchées par du contenu non-fiable** (sortie d'un outil précédent) — *taint-tracking* au bord de l'action, **pas** un firewall de prompt (xSOM n'en est pas un). Point d'extension déjà anticipé en V1.1 dans `CLAUDE.md §2`.

**Livrables**
- Modèle de *taint* : un `call_tool` dont le résultat provient d'une source externe non-fiable (fetch web, doc, corps d'email — classes `read`/contenu externe) marque la **session** `tainted`. Suivi par `session_id` (déjà porté par `usage_events` / `tracestate mip=s:`).
- `gateway/taint.py` + état `session_taint` (`tenant, session_id, tainted_at, source_tool`). Quand un outil `irreversible`/`external_send` est appelé dans une session `tainted` **dans la fenêtre** → escalade HITL (ou deny selon policy) + audit `tainted_action`.
- Heuristique sur le **résultat** d'un outil (jamais le prompt) : `ignore previous`, `forward to`, `send all`, URL d'exfiltration, blobs base64 → marque la session `tainted` (`taint_marked`).
- Réutilise `core/dlp.py` pour repérer l'exfiltration (email/domaine hors allowlist dans les args d'une action post-taint).
- Policy : `defaults.taint_policy` ∈ {`off`, `escalate`, `deny`} (défaut `off`) + fenêtre de taint (ex. 5 tool-calls ou 60 s).
- Audit : events `taint_marked`, `tainted_action`.

**Acceptation**
- Séquence [fetch web (tainted) → send_email irréversible] dans une même session → l'action `send` est escaladée HITL/deny + auditée `tainted_action`.
- Le même `send_email` dans une session non-tainted → suit la policy normale.
- Un résultat d'outil contenant un pattern d'injection → session marquée `tainted`.
- Fenêtre de taint respectée ; **aucun** contenu loggé (métadonnées + hash only, `§4.10`).

---

### Ordre de dépendances
M9 (A) → M10 (B) → M11 (C) → M12 (D). Tous s'appuient sur `policy`/`decision`/`audit`/`gateway` déjà livrés. M11 et M12 réutilisent `core/dlp.py`. Ne pas démarrer un milestone avant le précédent vert (`make verify`).
