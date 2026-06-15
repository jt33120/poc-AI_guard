# BUILD_PLAN.md — xSOM AI Guard (MVP)

Construire dans l'ordre. Un milestone n'est terminé que si ses **critères d'acceptation** passent et `make verify` est vert. Commit à la fin de chaque milestone.

---

## M0 — Bootstrap
**But** : squelette propre + outillage + CI.
**Livrables** : structure repo (`gateway/`, `core/`, `api/`, `frontend/`, `supabase/migrations/`, `scripts/`, `tests/`), `pyproject` (ruff, mypy, pytest), `Makefile` (`dev/test/verify/demo`), `.env.example` chargé via settings Pydantic, control API FastAPI durcie avec `GET /health`, squelette serveur MCP qui démarre, CI GitHub Actions (lint+types+tests+pip-audit+trufflehog+`scripts/audit_security.py`).
**Acceptation** : `make verify` vert ; `/health` répond ; le serveur MCP démarre et expose 0 outil ; CI verte.

## M1 — Auth & multi-tenant
**But** : identité + isolation.
**Livrables** : migrations `tenants`, `memberships` ; auth Supabase (vérif JWT JWKS) ; dépendance `get_current_user` + `require_role` ; RLS activée ; tenant token (clé API gateway sc-opée tenant, stockée hashée) pour la session MCP.
**Acceptation** : endpoint protégé refuse sans/￼avec mauvais token ; test RLS : user A ne lit pas les données de B ; session MCP refusée sans tenant token valide.

## M2 — Gateway MCP proxy (transparent)
**But** : relayer des outils en aval, sans contrôle encore.
**Livrables** : `downstream_servers` (CRUD via API) ; clients MCP aval (`stdio` + `http`) ; agrégation des `tools` (préfixage anti-collision) ; relais des `call_tool` ; logs structurés. Fournir un **serveur MCP factice** de test (`tests/fixtures/mock_mcp_server.py`, ex. `echo`, `delete_contact`).
**Acceptation** : un agent de test voit l'union des outils ; un `call_tool` est relayé et le résultat renvoyé ; tout est tracé en logs (pas encore audit immuable).

## M3 — Moteur de policy
**But** : classification + décision déterministe.
**Livrables** : schéma + parsing `tool_policies.yaml` ; `policy.classify()` + `policy.authorize()` ; branches `auto`/`deny` câblées dans le gateway ; API `GET/PUT /v1/policy` (validation) ; `GET /v1/tools` (classe effective).
**Acceptation** : tool `read` → relayé (`allow`) ; tool `irreversible` → `deny` si policy le dit ; tool inconnu → `deny` (fail-closed) ; YAML invalide → `422`.

## M4 — HITL & approbations
**But** : tenir l'humain dans la boucle.
**Livrables** : table `approvals` ; construction du dry-run ; suspension du `call_tool` (élicitation MCP si dispo, sinon `requires_approval` + ré-invocation) ; notification (SMTP/Gmail ; Notion optionnel) ; `GET /v1/approvals`, `POST /v1/approvals/{id}/decision` ; timeout→`expired` ; `human_dual`.
**Acceptation** : `irreversible` → approbation `pending`, outil aval **non appelé** ; `approve` → relayé une fois ; `deny`/timeout → jamais relayé ; service d'approbation down → fail-closed.

## M5 — Boîte noire d'audit
**But** : traçabilité immuable + conformité.
**Livrables** : `audit_log` + `audit.log_event()` hash-chaîné ; entrée par décision (allow/deny/hitl_*) ; `scripts/verify_chain.py` ; `GET /v1/audit` ; `GET /v1/audit/export?format=ai_act|rgpd` (JSON+PDF, narratif via juge).
**Acceptation** : chaque décision produit une entrée ; altérer une ligne casse `verify_chain` ; aucun argument sensible/PII dans la table (seulement `args_hash`) ; export généré.

## M6 — LLM juge mince
**But** : gérer l'ambigu + les narratifs.
**Livrables** : `core/judge.py` (LiteLLM→Mistral, sortie JSON stricte) ; appelé uniquement si `classify: ambiguous` (→ `action_class`, surclasse en cas de doute) et pour les narratifs d'export ; rate limit + cap coût ; `judge_used` tracé.
**Acceptation** : tool `ambiguous` aux arguments dangereux → classé en `irreversible`/HITL ; le juge n'autorise jamais seul ; coût borné (test du cap).

## M7 — Frontend
**But** : rendre le produit utilisable et démontrable.
**Livrables** : Next.js (auth Supabase, role-gated) — Inspecteur/playground, File d'approbation, Explorateur d'audit + export, Admin (éditeur policy + serveurs aval + tableau de bord). Tokens en cookie httpOnly. Smoke Playwright.
**Acceptation** : login ; approuver une action depuis l'UI exécute le tool tenu ; l'audit s'affiche et s'exporte ; éditer la policy change la décision observée ; smoke vert.

## M8 — Démo flagship & durcissement final
**But** : la démo qui vend + check sécurité.
**Livrables** : `make demo` (agent + serveur MCP factice : tente `delete_contact` → HITL → refus → l'outil n'est jamais appelé ; un `mail.send` hors allowlist → deny ; chaîne d'audit vérifiée) ; passe complète `scripts/audit_security.py` sans CRITIQUE ; README run<10min ; pentest checklist rapide (CORS, docs off, RLS, secrets).
**Acceptation** : `make demo` raconte l'histoire « l'agent ne peut pas agir sans contrôle » de bout en bout ; Definition of Done (`CLAUDE.md §7`) satisfaite.

---

### Ordre de dépendances
M0 → M1 → M2 → M3 → M4 → M5 → (M6 ∥ M7) → M8. Ne pas démarrer M7 avant M5 vert.
