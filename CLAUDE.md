# CLAUDE.md — Brief de construction (xSOM AI Guard, MVP)

> Tu es l'agent de dev de ce repo. Objectif : livrer un **MVP propre, sécurisé, testé**. Source d'autorité = ce fichier ; le détail = `docs/SPEC.md` ; l'ordre + les critères = `docs/BUILD_PLAN.md`. **Lis les trois avant de coder.** Travaille milestone par milestone, chaque milestone vert avant le suivant.

## 1. Mission

Construire **xSOM AI Guard** : un **gateway MCP de contrôle des actions** pour agents IA. Il se place entre un agent et ses serveurs d'outils MCP, et sur chaque tool-call : applique une **policy d'autorisation** (auto / validation humaine / refus), met l'**humain dans la boucle** sur les actions irréversibles (dry-run + approbation), et écrit un **journal d'audit immuable hash-chaîné** exportable pour la conformité. Plus une **control API** (FastAPI) et un **frontend** (Next.js) minimal.

Le différenciateur principal : on contrôle ce que l'agent **fait**, pas seulement les prompts. Le module séparé `secret-guard/` ajoute une protection locale ciblée contre les credentials dans les chemins de prompt qu'il contrôle ; ce n'est PAS un firewall universel de tout VS Code.

## 2. Scope MVP — et non-objectifs

**DANS** : auth multi-tenant (Supabase + RLS + RBAC) ; gateway MCP (proxy de serveurs d'outils en aval) ; moteur de policy déterministe + classification d'action ; HITL (dry-run, approbation, timeout) ; audit immuable hash-chaîné + exports AI Act/RGPD ; LLM juge mince (cas ambigus + génération des narratifs de conformité) ; frontend (inspecteur, file d'approbation, explorateur d'audit, éditeur de policy) ; Secret Guard V0 local (`docs/secret-guard/`) ; tests + CI.

**HORS (points d'extension seulement, ne pas implémenter)** : guard prompt injection, scan automatique des pièces jointes/repositories, PII stripping dans Secret Guard, OCR/PDF, médiation RAG, fleet/GitOps multi-instances, hébergement souverain OVH/Keycloak, anomaly detection ML.

## 3. Stack imposée

- **Gateway** : Python 3.12, **MCP Python SDK** (serveur MCP côté agent + client MCP vers les serveurs en aval).
- **Control API** : **FastAPI**, **Pydantic v2**, **slowapi**, **python-jose** (JWT Supabase).
- **Intelligence** : moteur déterministe (Python + `pyyaml`) ; **LiteLLM → Mistral** (`mistral-small-latest`) pour le LLM juge, appelé avec parcimonie.
- **Données / Auth** : **Supabase** (Postgres + Auth + RLS).
- **Frontend** : **Next.js 14 (App Router)** + **Tailwind** + `@supabase/supabase-js`.
- **Secret Guard** : **TypeScript strict** sans dépendance runtime pour le core ; CLI Node ; extension VS Code 1.137+ ; aucun réseau ni ML sur le chemin de détection.
- **Observabilité** : **Sentry** + logs JSON structurés.
- **Tests** : **pytest** + **httpx** ; **Playwright** (smoke front).
- **Qualité** : **ruff** + **mypy** ; **eslint** + **tsc**.
- **CI** : GitHub Actions — lint, types, tests, `pip-audit`, `trufflehog`, `scripts/audit_security.py`.

Pas de composant ni de dépendance hors liste sans justification dans le PR.

## 4. Règles de sécurité NON négociables

1. HITL garanti **au niveau du gateway**, jamais délégué au LLM. Action irréversible non approuvée = non exécutée.
2. `audit_log` strictement **append-only** (aucune policy UPDATE/DELETE ; immuabilité par hash-chaining).
3. Isolation tenant par **RLS Postgres**, pas seulement applicative.
4. Tool inconnu / service d'approbation indisponible → **fail-closed** (deny) sur l'irréversible.
5. Jamais de token en `localStorage` → cookie `httpOnly`+`Secure`+`SameSite`.
6. `service_role` Supabase = backend uniquement, jamais au front ni commité.
7. Aucun secret en clair / dans git (`trufflehog` en CI) → tout en `.env` (gitignored).
8. `/docs` & `/redoc` off si `ENV=prod` ; `debug=False` ; aucune stack trace au client.
9. Validation Pydantic stricte (longueurs bornées) ; rate limit sur les endpoints coûteux (LLM juge).
10. Ne jamais logger le **contenu** des arguments d'outils sensibles ni de PII → métadonnées + hash uniquement.
11. Secret Guard ne retourne ni ne journalise la valeur détectée ; scan incomplet, erreur ou entrée > 1 Mio = blocage explicite, jamais de suffixe non scanné transmis.

## 5. Conventions de code

Fonctions petites et explicites, une responsabilité. Typage strict (mypy, TS strict). Pas d'abstraction spéculative, pas de code mort. Erreurs gérées explicitement. Chaque module a ses tests. Commits petits et atomiques (un par sous-tâche du BUILD_PLAN), messages conventionnels.

## 6. Méthode de travail

Pour chaque milestone de `docs/BUILD_PLAN.md` (M0→M8) : lire les critères → implémenter le strict nécessaire → écrire/passer les tests → `make verify` **vert** → commit. Ne pas sauter de milestone ; pas de frontend (M7) avant backend vert.

## 7. Definition of Done

- Critères d'acceptation M0→M8 passés.
- `make verify` vert : ruff, mypy, pytest (≥ 70% sur la logique métier), eslint, tsc, Playwright smoke.
- `pip-audit` sans CVE critique ; `trufflehog` sans secret ; `scripts/audit_security.py` sans CRITIQUE.
- `npm --prefix secret-guard run verify` vert : lint, types stricts, couverture unitaire, contrats subprocess/hooks, Extension Host, contenu VSIX, latence et audit npm.
- README : run local en < 10 min depuis `.env.example`.
- **Démo** `make demo` : un agent tente une action irréversible → tenue en HITL → refus → l'action n'a PAS eu lieu ; un tool-call sensible avec données → audit écrit ; `verify_chain` confirme la chaîne intacte.

## 8. Commandes (Makefile à créer)

```
make dev      # gateway MCP + control API + front
make test     # pytest + playwright smoke
make verify   # ruff + mypy + eslint + tsc + tests + scripts/audit_security.py
make demo     # scénario break-then-control de bout en bout
npm --prefix secret-guard run verify  # core local + CLI/hooks + extension VS Code
```

## 9. Références
`docs/SPEC.md` · `docs/BUILD_PLAN.md` · `.env.example`. En cas d'ambiguïté : préférer la sécurité (fail-closed) et le scope minimal, et poser la question dans le PR plutôt que d'élargir.
