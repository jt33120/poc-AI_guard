# SPEC.md — xSOM AI Guard (MVP)

Version 2.0 · 2026-06-15 · cible : exécution par Claude Code.

---

## 1. Objectif

Permettre à une entreprise de mettre un agent IA en production sans risque d'action non maîtrisée. **xSOM AI Guard** est un **gateway MCP** : l'agent appelle ses outils *à travers* le gateway, qui autorise, met l'humain dans la boucle, et trace chaque action de façon immuable.

**Pourquoi MCP** : c'est le point de contrôle réel de l'agentivité (l'exécution des outils), un standard d'intégration qui se généralise, et l'intégration côté client est une simple **reconfiguration** (pointer l'agent vers le gateway au lieu des serveurs d'outils directs). On ne touche pas au code de l'agent.

---

## 2. Périmètre

**MVP** : auth multi-tenant ; gateway MCP (proxy de N serveurs d'outils en aval) ; moteur de policy + classification d'action ; HITL (dry-run + approbation + timeout) ; audit immuable hash-chaîné + exports AI Act/RGPD ; LLM juge mince ; control API ; frontend (4 écrans) ; tests + CI.

**Hors MVP (extensions)** : prompt injection, PII stripping, médiation RAG, fleet, souverain, anomaly ML.

---

## 3. Architecture

```
        ┌─────────────┐     MCP      ┌───────────────────────┐    MCP    ┌──────────────────┐
Agent IA│ client MCP  │ ───────────▶ │  xSOM AI Guard         │ ────────▶ │ Serveurs d'outils │
(client)└─────────────┘              │  (gateway MCP)         │           │ MCP en aval       │
                                     │  policy → HITL → audit │           │ (mail, CRM, fs…)  │
                                     └───────────┬───────────┘           └──────────────────┘
                                                 │
                       ┌─────────────────────────┼───────────────────────────┐
                       ▼                          ▼                           ▼
                 Supabase (Auth+              LLM juge (Mistral,         Control API (FastAPI)
                 Postgres+RLS,                cas ambigus +              ← Frontend Next.js
                 audit append-only)           narratifs conformité)      (inspecteur, approbations,
                                                                          audit, policy)
```

**Deux surfaces réseau** :
1. Le **gateway MCP** (protocole MCP) — consommé par l'agent.
2. La **control API** (HTTP/JSON, FastAPI) — consommée par le frontend (policy, audit, approbations, exports).

Le gateway agit comme **serveur MCP** vis-à-vis de l'agent et comme **client MCP** vis-à-vis des serveurs d'outils en aval (proxy transparent : il agrège leurs `tools`, relaie les `call_tool` après décision).

### Modules backend
`gateway/server.py` (serveur MCP + proxy), `gateway/downstream.py` (clients MCP aval), `core/policy.py` (matrice + classification), `core/judge.py` (LLM juge), `core/approvals.py` (HITL), `core/audit.py` (log + hash-chain), `api/main.py` (control API durcie), `api/security.py` (auth+RBAC), `core/db.py` (Supabase), `core/schemas.py` (Pydantic).

---

## 4. Modèle de données (Supabase / Postgres)

RLS activé partout. Migrations dans `supabase/migrations/`.

```sql
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table memberships (
  user_id uuid references auth.users(id),
  tenant_id uuid references tenants(id),
  role text not null check (role in ('admin','operator','viewer')),
  primary key (user_id, tenant_id)
);

-- Serveurs d'outils en aval déclarés par tenant
create table downstream_servers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) not null,
  name text not null,
  transport text not null check (transport in ('stdio','http')),
  config jsonb not null,          -- commande/URL/headers (secrets via env refs, pas en clair)
  enabled boolean default true
);

create table tool_policies (
  id bigint generated always as identity primary key,
  tenant_id uuid references tenants(id) not null,
  yaml text not null,
  version int not null default 1,
  updated_at timestamptz default now()
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  request_id text not null,
  tool_name text not null,
  arguments_summary jsonb not null,   -- résumé/hashé, pas les secrets bruts
  dry_run jsonb not null,             -- effet simulé présenté à l'humain
  status text not null default 'pending' check (status in ('pending','approved','denied','expired')),
  requested_by text, decided_by text,
  created_at timestamptz default now(), decided_at timestamptz, expires_at timestamptz
);

create table audit_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null,
  tenant_id text not null, user_id text, request_id text,
  tool_name text, action_class text,    -- read|write|external_send|irreversible
  decision text,                         -- allow|deny|hitl_pending|hitl_approved|hitl_denied|expired
  policy_rule_id text, judge_used boolean default false,
  args_hash text,                        -- sha256 des arguments, jamais les valeurs sensibles
  latency_ms int, error text,
  prev_hash text not null, entry_hash text not null
);
```

**RLS** : lecture limitée au `tenant_id` du JWT (`auth.jwt() -> 'app_metadata' ->> 'tenant_id'`) sur toutes les tables tenant ; `audit_log` = **INSERT only** (pas d'UPDATE/DELETE). Écritures backend via `service_role` ; lectures front via `anon` (RLS appliquée).

---

## 5. Le gateway MCP (cœur)

### 5.1 Initialisation
Au démarrage (par tenant), le gateway lit `downstream_servers`, ouvre un client MCP vers chacun, récupère leurs `tools`, et expose l'union au client agent (préfixage `server.tool` si collision).

### 5.2 Cycle d'un `call_tool`
1. **Identité & tenant** : résolus depuis le contexte de session (token tenant passé à l'établissement de la session MCP — cf. §8 auth).
2. **Classification** : `policy.classify(tool_name, arguments)` → `action_class` (read/write/external_send/irreversible). Déterministe via la policy ; si la policy marque le tool `ambiguous`, appeler le **LLM juge** (§6).
3. **Décision** : `policy.authorize(action_class, tool)` → `auto | human_in_the_loop | human_dual | deny`.
4. **Branche** :
   - `auto` → relayer au serveur aval, récupérer le résultat, audit `allow`.
   - `deny` → ne pas relayer, audit `deny`, renvoyer une erreur MCP explicite à l'agent.
   - `human_*` → construire le **dry-run** (description lisible de l'effet), créer un `approvals` (pending, `expires_at`), notifier (§7), et **suspendre** : préférer l'**élicitation MCP** si supportée par le client (demande d'approbation synchrone) ; sinon, renvoyer un résultat MCP `requires_approval` avec `approval_id` (l'agent ré-invoque après décision). Sur `approved` → relayer puis audit `hitl_approved` ; sur `denied`/`expired` → audit correspondant, ne pas exécuter.
5. **Audit** : une entrée hash-chaînée par décision (§9).

### 5.3 Garanties
HITL imposé par le gateway (jamais par le prompt). Fail-closed : tool inconnu, policy absente, ou service d'approbation KO sur une action `irreversible` → `deny`.

---

## 6. Intelligence : déterministe d'abord, LLM juge mince

- **Déterministe (par défaut)** : classification et autorisation viennent de la policy YAML. C'est le chemin chaud, rapide, testable, reproductible.
- **LLM juge (`core/judge.py`, LiteLLM→Mistral)** appelé seulement si :
  1. le tool est marqué `classify: ambiguous` dans la policy (ex. un outil générique dont la dangerosité dépend des arguments) → le juge renvoie un `action_class` + justification courte (sortie structurée JSON stricte). En cas de doute, le juge **surclasse** (plus prudent).
  2. génération des **narratifs de conformité** pour les exports (résumer une série d'événements d'audit en langage AI Act/RGPD).
- Le juge ne décide jamais seul d'autoriser une action irréversible : il ne fait que **classer** ; la décision reste à la matrice + HITL. Rate-limité et borné en coût.

---

## 7. HITL & approbations

`approvals` : création (pending + dry_run + `expires_at = now + hitl_timeout`), notification (email via SMTP/Gmail ; optionnel : page Notion), décision via control API, exécution/annulation, expiration → `expired` (= deny). Le `dry_run` décrit l'effet sans le déclencher (ex. « envoi d'un email à x@client.fr, objet … »). Approbation asynchrone supportée. `human_dual` = deux approbateurs distincts requis.

---

## 8. Control API (FastAPI) — contrats

Base durcie (CORS explicite, `/docs` off en prod, headers, handler d'erreur sans fuite). Auth `Authorization: Bearer <supabase_jwt>` sauf `/health`.

- `GET /health` → `{"status":"ok"}`.
- `GET /v1/policy` · `PUT /v1/policy` (admin) — lire/valider/incrémenter la policy YAML (schéma §10). `422` si invalide.
- `GET /v1/servers` · `POST /v1/servers` · `PATCH /v1/servers/{id}` (admin) — déclarer les serveurs d'outils aval.
- `GET /v1/approvals?status=pending` — file du tenant.
- `POST /v1/approvals/{id}/decision` `{ "decision": "approve"|"deny" }` (operator/admin) — décide ; déclenche exécution/annulation côté gateway.
- `GET /v1/audit?from=&to=&decision=&tool=` — événements (RLS).
- `GET /v1/audit/export?format=ai_act|rgpd&from=&to=` — rapport (JSON + PDF) ; narratif généré par le LLM juge.
- `GET /v1/tools` — outils exposés (union des serveurs aval) + leur classe/policy effective (pour le frontend).

Auth gateway MCP (§5.1) : la session MCP est établie avec un **token de tenant** (clé d'API gateway sc-opée tenant, stockée hashée). Pas de JWT utilisateur dans le flux agent (c'est machine-to-machine).

---

## 9. Audit & hash-chaining

Par événement : construire le dict sans `entry_hash`, lire `prev_hash` (dernier `entry_hash` du tenant, ou `"GENESIS"`), puis
```
entry_hash = sha256( prev_hash + json.dumps(event, sort_keys=True, separators=(',',':')) )
```
INSERT append-only. `scripts/verify_chain.py` relit dans l'ordre et recalcule : toute rupture = altération. **Jamais loggé** : valeurs d'arguments sensibles, secrets, PII, contenu — uniquement métadonnées + `args_hash`. Exports : AI Act (registre des décisions + preuves de supervision humaine via `approvals` + trace par requête) ; RGPD (journal de traitement, endpoint d'effacement, rétention configurable).

---

## 10. Format de policy (`tool_policies.yaml`, par tenant)

```yaml
tools:
  - name: filesystem.read_file
    class: read
    approval: auto
  - name: crm.update_contact
    class: write
    approval: auto
    constraints: { reversible: true }
  - name: mail.send
    class: external_send
    approval: human_in_the_loop
    constraints: { allowed_domains: ["@client.fr"], dry_run: true }
  - name: crm.delete_contact
    class: irreversible
    approval: human_dual
    constraints: { dry_run: true, business_hours_only: true }
  - name: shell.exec
    classify: ambiguous       # → LLM juge détermine action_class selon arguments
    approval: human_in_the_loop
defaults:
  unknown_tool: deny          # fail-closed
  hitl_timeout_seconds: 3600
  on_approval_service_down: deny
```
Validation au `PUT` : `name` unique, `class`/`approval` dans l'énum, cohérence `classify: ambiguous`.

---

## 11. Sécurité (mapping) & règles
Cf. `CLAUDE.md §4`. OWASP Web (Broken Access Control → RLS+RBAC ; Misconfiguration → docs off/CORS/headers ; Vulnerable Components → pip-audit ; Logging → audit immuable) + OWASP LLM (Excessive Agency → cœur du produit ; Unbounded Consumption → rate limit + cap sur le juge).

---

## 12. Frontend (Next.js)
Auth Supabase (cookie httpOnly), vues role-gated.
- **Inspecteur (playground)** : voir les outils exposés + leur classe/décision ; rejouer un tool-call de test et voir la décision (auto/HITL/deny) + l'entrée d'audit.
- **File d'approbation** : `approvals` pending, dry-run affiché, Approuver/Refuser → `POST /v1/approvals/{id}/decision`.
- **Explorateur d'audit** : table filtrable (`GET /v1/audit`) + bouton export AI Act/RGPD.
- **Admin** : éditeur de policy (YAML, validé) + déclaration des serveurs aval + tableau de bord (taux auto/HITL/deny, approbations en attente).

---

## 13. Tests & critères d'acceptation
- **Unit** : `policy.classify`/`authorize` (toutes branches + unknown→deny) ; `audit` hash-chain (insertion + détection d'altération) ; juge (mocké) surclasse en cas de doute.
- **Intégration** : un `call_tool` `read` passe et est relayé ; un `irreversible` crée une approbation et n'est PAS relayé tant que non approuvé ; après `approve`, il est relayé ; **isolation tenant** (user A ne lit pas l'audit/approvals de B via RLS) ; fail-closed quand le service d'approbation est down.
- **E2E `make demo`** : agent + serveur d'outils MCP factice (ex. `delete_contact`) → tentative → HITL → refus → vérifier que l'outil aval n'a jamais été appelé ; `verify_chain` OK.

---

## 14. Pièges à éviter
Ne pas exécuter une action avant décision ; ne pas faire confiance au LLM pour la décision (il classe, il n'autorise pas) ; RLS obligatoire ; pas de contenu/PII dans les logs ; pas de RAG/fleet/souverain dans le MVP ; `service_role` jamais au front.
