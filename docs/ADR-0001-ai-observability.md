# ADR-0001 — Supervision/observabilité IA dans xSOM AI Guard

> **Statut : Proposé (à valider avant tout code).**
> **Date : 2026-07-20.**
> **Contexte :** transposer la « supervision IA » de `mip-rum` (voir le brief d'extraction)
> dans `xsom-ai-guard`, en **sens 1** (cloner la capture côté xsom) pour permettre ensuite le
> **sens 2** (remplacer le code local de `mip-rum` par des appels à xsom).

## 0. Décisions déjà prises (cadrage)

1. **Runtime = FastAPI natif** (pas d'edge Deno / lift-and-shift). Le stack imposé de xsom
   (`CLAUDE.md §3`) est FastAPI + Pydantic v2 + Postgres/Supabase + Next.js. On porte le
   **modèle de données et le SQL** ; on ré-implémente seulement la couche HTTP.
2. **Modèle de données = étendre `usage_events`** (pas de nouvelle table `rum_ai` parallèle).
   xsom écrit déjà 1 ligne par appel LLM dans `usage_events` (chemin proxy inline). On lui
   ajoute les colonnes manquantes et on **reconstruit le contrat `/ai/summary` par-dessus**,
   plutôt que de maintenir deux systèmes de coût.
3. **ADR d'abord** : ce document est le livrable à valider ; le code suit en phases (§8).

### Ce que xsom a déjà (à ne pas recloner)

| Brief `mip-rum` | Équivalent xsom existant |
|---|---|
| `rum_ai` (1 ligne/appel) | `usage_events` (chemin **proxy inline**, `core/usage.py`) |
| coût réel `gen_ai.usage.cost` | `billed_cost` (`core/billing.py`, coût autoritatif) |
| `ai-pricing.mjs` | `core/pricing.py` (`cost_usd(provider, model, in, out)`) |
| `latency_ms`, `status`, `error` | `audit_log` (mais **chemin MCP seulement**, pas LLM) |
| attribution app/user | `tenant_id` + `gateway_tokens.client_id` (+ `gateway_token_id`) |
| RLS `console_ro` | RLS Supabase par `tenant_id` (`auth.jwt() app_metadata`) |

### La différence de **mode** (le vrai apport)

- **xsom aujourd'hui = capture _inline_** : l'agent **doit router** son trafic LLM par le proxy
  (`/proxy/...`). xsom ne voit que ce qu'il proxifie.
- **`rum_ai` = ingestion _OTLP push_** : n'importe quel backend émet des spans `gen_ai.*`
  **après coup**, sans router son trafic.

Ajouter l'ingestion OTLP à xsom lui donne l'**observabilité passive** en plus du **contrôle
inline** — c'est le palier produit, pas un simple clone. Les deux flux écrivent dans le même
`usage_events`, distingués par une colonne `source` (`'proxy'` | `'otlp'`).

---

## 1. Mapping `gen_ai.*` → `usage_events` étendu

Colonnes **existantes** (0006) réutilisées telles quelles : `tenant_id`, `gateway_token_id`,
`provider`, `model`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost_usd`,
`request_id`, `ts`.

Colonnes **à ajouter** (migration 0011, proposée — voir §2) :

| Champ `rum_ai` | Attribut OTLP source (brief §3.1) | Colonne `usage_events` (nouvelle) |
|---|---|---|
| `span_id` | `spanId` / `mip.span_id` | `span_id` (idempotence OTLP) |
| `trace_id` | `traceId` / `mip.trace_id` | `trace_id` |
| `session_id` | `tracestate mip=s:<id>` / `mip.session_id` | `session_id` |
| `operation` | `gen_ai.operation.name` | `operation` |
| `route` | `gen_ai.route` / `mip.route` | `route` |
| `latency_ms` | span `end−start` / `gen_ai.latency_ms` | `latency_ms` |
| `ttft_ms` | `gen_ai.server.time_to_first_token` / `gen_ai.ttft_ms` | `ttft_ms` |
| `status` / `error_type` | `error.type` / `gen_ai.error.type` | `status`, `error_type` |
| `user_hash` (via `rum_session`) | `mip.user_hash` (attribut, si émis) | `user_hash` |
| `app_id` | attribut ressource `mip.app_id` | → **`client_id`** (voir §6, C3) |
| provenance | — | `source` (`'proxy'` défaut, `'otlp'` pour l'ingestion) |

`provider`/`model`/tokens/`cost_usd` suivent la **même règle de priorité et d'estimation** que
le brief §3.1 : coût réel `gen_ai.usage.cost` s'il est fourni, sinon `pricing.cost_usd(...)`
(on réutilise `core/pricing.py`, pas de nouvelle table de prix).

**Règle de rejet** (seule « validation ») identique au brief : ligne droppée sauf si `span_id`
**et** (`provider` **ou** `model`) présents.

---

## 2. Extension de schéma — migration `0011` (proposée)

```sql
-- 0011_ai_observability.sql  (PROPOSÉ — non appliqué)
alter table usage_events
  add column if not exists source      text not null default 'proxy',  -- 'proxy' | 'otlp'
  add column if not exists span_id     text,
  add column if not exists trace_id    text,
  add column if not exists session_id  text,
  add column if not exists operation   text,
  add column if not exists route       text,
  add column if not exists latency_ms  double precision,
  add column if not exists ttft_ms     double precision,
  add column if not exists status      text not null default 'ok',      -- 'ok' | 'error'
  add column if not exists error_type  text,
  add column if not exists user_hash   text,
  add column if not exists client_id   uuid references clients (id) on delete set null;

-- OTLP idempotence : 1 ligne par span (les lignes proxy ont span_id null).
create unique index if not exists uq_usage_span on usage_events (span_id) where span_id is not null;
create index if not exists idx_usage_op     on usage_events (tenant_id, operation);
create index if not exists idx_usage_route  on usage_events (tenant_id, route);
create index if not exists idx_usage_status on usage_events (tenant_id, status);
```

Rétro-compatibilité : toutes les colonnes ont un défaut ou sont nullables → le chemin proxy
actuel (`core/usage.record_usage`) continue d'insérer sans changement (`source='proxy'`,
`status='ok'`, le reste `null`). La RLS `usage_select_own` couvre déjà les nouvelles colonnes.

**Optionnel (phase 2) — enrichir aussi le chemin proxy :** aujourd'hui `api/llm_proxy._forward`
ne chronomètre pas l'appel amont. Ajouter un `time.monotonic()` autour du `client.post(...)`
renseignerait `latency_ms` pour les lignes `source='proxy'` — les deux modes deviennent
homogènes.

---

## 3. Ingestion OTLP `gen_ai` — `POST /v1/ai-traces`

- **Auth = jeton gateway xSOM** (`xsg_...`), déjà en place. Le backend externe (UTI) présente
  son token (header `X-Gateway-Token` **ou** attribut ressource `mip.api_key`) →
  `resolve_gateway_principal` → `tenant_id` (+ `client_id` via le token, ou attribut
  `mip.app_id` mappé en client). **Aucun nouveau modèle d'auth** ; fail-closed comme le reste.
- **Corps** : OTLP/HTTP JSON. On porte la branche `gen_ai` de `flattenOtlp()` (brief §3.1) en
  Python (`core/otlp_genai.py`) : mêmes attributs, mêmes priorités, même dérivation de tokens,
  même `pricing.cost_usd` en repli.
- **Écriture** : `insert ... on conflict (span_id) do nothing` (idempotent), `source='otlp'`.
  Un span IA **ne crée pas** de session/agent — corrélation logique par `session_id`.
- **Garde-fous** : bornes `MAX_BODY_BYTES` / `MAX_SPANS_PER_REQUEST` (config), rate-limit
  slowapi (comme le proxy LLM), et — cohérent avec `CLAUDE.md §4.10` — **aucun contenu**
  utilisateur ingéré, métadonnées + tokens uniquement.

> Réutilisation forte : `resolve_gateway_principal`, `pricing.cost_usd`, `db.connection`,
> le pattern `run_in_threadpool` du proxy. Le seul code neuf = le parseur OTLP `gen_ai`.

---

## 4. Read-API — `GET /ai/summary`

Renvoie **exactement** le sous-objet IA du `RumSummary` (brief §3.4) pour que la facade
`mip-rum` `/api/rum/summary` puisse l'étaler tel quel :

```
{ ai_calls, ai_tokens, ai_cost_usd, ai_p75_latency_ms, ai_error_rate,
  ai_by_model[], ai_top_users[], ai_by_operation[], ai_series[] }
```

Calcul depuis `usage_events` (RLS tenant, filtre `window ∈ 24h|7d|30d`, `core/ai_summary.py`) :

| Champ | Source de calcul |
|---|---|
| `ai_calls` / `ai_tokens` / `ai_cost_usd` | `count(*)`, `sum(total_tokens)`, `sum(cost_usd)` |
| `ai_p75_latency_ms` | `percentile_cont(0.75) within group (order by latency_ms)` |
| `ai_error_rate` | `count(status='error') / count(*)` |
| `ai_by_model[]` | `group by provider, model` |
| `ai_by_operation[].refusal_rate` | `status='error' and error_type ~* 'refus\|guardrail\|safety\|moderation'` |
| `ai_by_operation[].anomaly / anomaly_score` | via la vue `v_ai_op_anomaly` (§5) |
| `ai_series[]` | buckets journaliers |
| `ai_top_users[]` | `group by user_hash` (voir C3) |

**Champs qualité en `null` en phase 1** : `regen_rate`, `thumbs_down_rate`, `csat` dépendent
d'événements front (`rum_event`) que xsom n'ingère pas encore (voir C2). Règle contractuelle
respectée : **métrique absente = `null`, jamais la clé omise** ; taux arrondis à 4 décimales.

**Auth `/ai/summary`** : JWT Supabase (`require_tenant`) pour la console. Pour l'appel
**serveur-à-serveur** de la facade `mip-rum`, il faut un jeton machine → **décision restante**
(§9-D1) : réutiliser un jeton gateway en lecture, ou introduire un `read_token` dédié (SHA-256,
1 jeton → 1 tenant, à l'image des `read_tokens` de `mip-rum`).

Endpoints fins `GET /ai`, `/ai/costs`, `/ai/credits` : mêmes builders sur `usage_events`
(+ `billed_cost` pour le réel). `/ai/credits` (solde OpenRouter) = **phase 3** (nouvelle
petite table `provider_balance` + cron, calquée sur `openrouter_balance`).

---

## 5. Anomalie de coût — vue `v_ai_op_anomaly`

Portée verbatim du brief §3.3, sur `usage_events`, groupée par `tenant_id, operation, route`
(z-score du coût 24h vs moyenne des 8 jours précédents, seuil > 3). Alimente le flag
`anomaly`/`anomaly_score` de `/ai/summary`.

**Alerting** : xsom **n'a pas** le backbone `alert_rule`/`alert_event`/`route_alert` de
`mip-rum` (ses migrations 0001–0010 n'ont pas d'alerting générique). Deux voies :
- **Phase 2 (léger)** : une fonction Python schedulée émet via le `Notifier` existant
  (`core/notify.py`) quand la vue signale une anomalie — pas de nouvelles tables.
- **Phase 3 (complet)** : porter un backbone d'alerte minimal (règles budget `ai_cost` +
  baseline) si xsom veut le « budget IA journalier » du brief.

---

## 6. Résolution des coutures (C1–C6) pour le stack xsom

| # | Couture (brief) | Résolution côté xsom |
|---|---|---|
| **C1** | Ingestion partagée | Endpoint dédié `POST /v1/ai-traces` (auth jeton gateway). UTI **repointe** son exportateur backend vers xsom ; aucun forward. |
| **C2** | `rum_event` (qualité) partagé | **Phase 1** : `regen/thumbs/csat` = `null`. **Phase 2** : soit dual-emit du front vers xsom (`POST /v1/ai-events`), soit API interne `mip→xsom`. Décision produit (§9-D3). |
| **C3** | `rum_session.user_hash` | xsom n'a pas de sessions RUM. `ai_top_users` groupe sur `usage_events.user_hash` (attribut `mip.user_hash` émis à la source). `app_id` → `client_id` (l'entité surveillée). |
| **C4** | `/api/rum/summary` fusionné | **Facade côté `mip-rum`** (sens 2, hors de ce repo) : `mip-rum` appelle `xsom/ai/summary` et étale le résultat. Le contrat UTI reste identique. |
| **C5** | Alerting partagé | xsom embarque **sa propre** voie (Notifier en phase 2, backbone minimal en phase 3). |
| **C6** | `ai_briefing` (copilote console) | **Hors périmètre** — ne pas migrer. |

> **Limite de session (rappel).** Ma session n'a accès qu'à `jt33120/xsom-ai-guard`. Le **sens 2**
> (facade + suppressions dans `mip-rum`) édite un autre repo → à faire dans une session sur
> `mip-rum` (je peux l'ajouter via `add_repo` si tu veux qu'on l'enchaîne).

---

## 7. Dette & RGPD (à traiter dans le clone, pas à recopier)

- **Rétention/effacement** : le brief note que `rum_ai` n'a aucun chemin de purge. En étendant
  `usage_events`, on **doit** ajouter (a) une rétention configurable et (b) un effacement par
  tenant/session (RGPD). À faire en phase 1 pour ne pas répéter la dette.
- **PII** : `user_hash` seulement (jamais d'identifiant brut), **aucun contenu** (déjà la règle
  `CLAUDE.md §4.10`). `route`/`operation` sont des métadonnées.
- **Devise** : `cost_usd` reste en USD (comme l'existant) ; conversion EUR = hors périmètre.
- **Test de forme** : le brief signale l'absence de test sur `/rum/summary`. Ici on ajoute un
  test Pydantic + un test de forme sur `/ai/summary` dès la phase 1.

---

## 8. Plan par phases (chaque phase = 1 PR draft, `make verify` vert)

- **Phase 0** — ce ADR (validation).
- **Phase 1** — cœur ingestion + lecture :
  migration `0011` ; `core/otlp_genai.py` (parseur `gen_ai`) ; `POST /v1/ai-traces` ;
  `core/ai_summary.py` + `GET /ai/summary` (métriques pures, qualité `null`) ; rétention/erasure ;
  tests (parseur, ingestion idempotente, forme `/ai/summary`).
- **Phase 2** — profondeur :
  vue `v_ai_op_anomaly` + flag anomalie dans `/ai/summary` ; `GET /ai`, `/ai/costs` ;
  latence sur le chemin proxy inline ; alerte anomalie via `Notifier`.
- **Phase 3** — complétude :
  signaux qualité (C2 : `POST /v1/ai-events` ou dual-emit) ; `/ai/credits` + `provider_balance`
  + cron ; budget `ai_cost` (backbone d'alerte minimal) ; `GET /ai/openapi`.
- **Sens 2** (repo `mip-rum`, autre session) : facade `/api/rum/summary` → `xsom/ai/summary`,
  puis suppression du code IA local.

---

## 9. Décisions restantes (te concernent — bloquent le code de la phase 1)

- **D1 — Auth de `/ai/summary` en serveur-à-serveur** (pour la facade `mip-rum`) : réutiliser un
  **jeton gateway** en lecture, ou introduire un **`read_token`** dédié (recommandé : `read_token`,
  1 jeton → 1 tenant, révocable — plus propre pour un contrat externe) ?
- **D2 — Portée d'attribution** : `mip.app_id` → **`client_id`** (l'entité surveillée) confirmé,
  et le `tenant_id` = le compte xSOM qui héberge la supervision ?
- **D3 — Signaux qualité (C2)** : phase 1 = `null` (acté). En phase 3, **dual-emit** du front vers
  xsom, ou **API interne** `mip→xsom` ?
- **D4 — Sens 2** : veux-tu que j'ajoute le repo `mip-rum` à la session pour enchaîner la facade,
  ou on s'arrête au sens 1 côté xsom pour l'instant ?
- **D5 — Timing proxy** : on ajoute la mesure de latence sur le chemin proxy inline (phase 2) pour
  homogénéiser les deux modes ?

> **Recommandation de démarrage** : valider ce ADR, puis je fais la **Phase 1** (ingestion +
> `/ai/summary`), qui est le strict nécessaire pour que `mip-rum` puisse commencer à appeler xsom.
