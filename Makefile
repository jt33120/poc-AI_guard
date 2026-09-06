# xSOM AI Guard — task runner (CLAUDE.md §8).
# Canonical targets: dev / test / verify / demo. Compose targets: up / down / logs.
UV ?= uv
COMPOSE ?= docker compose
# Mirrors the defaults in docker-compose.yml, for the URLs printed by `make up`.
XSOM_API_PORT ?= 8000

.PHONY: install frontend-install dev test verify demo lint fmt fmt-check typecheck audit \
        coverage-gate coverage-map threat-rows marketing-facts replays migrations-manifest sovereignty-gate verify-frontend test-frontend seed-demo clean up down down-hard logs ps cli backup restore overhead overhead-gate

install:           ## Install backend + frontend deps
	$(UV) sync
	@$(MAKE) frontend-install

frontend-install:
	@if [ -f frontend/package.json ]; then \
		npm --prefix frontend install && \
		npm --prefix frontend exec playwright install --with-deps chromium; \
	fi

dev:               ## Run control API (+ frontend if scaffolded); gateway MCP runs over stdio
	@echo ">> control API on http://localhost:8000 (gateway MCP: stdio, see gateway/server.py)"
	@if [ -f frontend/package.json ]; then npm --prefix frontend run dev & fi
	$(UV) run uvicorn api.main:app --reload --port 8000

test: test-frontend  ## Run pytest (+ Playwright smoke when the frontend is installed)
	$(UV) run pytest

test-frontend:
	@if [ -d frontend/node_modules ]; then \
		echo ">> frontend e2e (Playwright smoke)"; \
		npm --prefix frontend run test:e2e; \
	else \
		echo ">> frontend deps not installed: Playwright smoke skipped (run 'make install')"; \
	fi

lint:              ## ruff lint
	$(UV) run ruff check .

fmt:               ## ruff auto-format
	$(UV) run ruff format .

fmt-check:         ## ruff format check (CI/verify)
	$(UV) run ruff format --check .

typecheck:         ## mypy strict over source packages
	$(UV) run mypy core api gateway scripts cli

audit:             ## Static security audit (fails on CRITICAL)
	$(UV) run python scripts/audit_security.py

sovereignty-gate:  ## AD-25/SM-15: nothing on the decision path can reach the network
	$(UV) run python scripts/audit_sovereignty.py

# verify = ruff + mypy + tests + audit_security (+ eslint/tsc when frontend exists).
# CLAUDE.md §8. Frontend checks are skipped cleanly until M7 scaffolds frontend/.
verify: lint fmt-check typecheck test audit sovereignty-gate coverage-gate overhead-gate verify-frontend
	@echo ">> verify: OK"

seed-demo:         ## Load the committed demonstration tenant (FR-182/183)
	$(UV) run python scripts/seed_demo.py

coverage-gate:     ## CM-7: every `Bloqué` claim is backed by a passing scenario
	$(UV) run python scripts/gen_coverage.py --check

overhead:          ## Regenerate the published per-call cost registry (EXH-9)
	uv run python scripts/measure_overhead.py

overhead-gate:     ## EXH-9: the per-call cost registry matches what the suite measured
	uv run python scripts/measure_overhead.py --check

coverage-map:      ## Regenerate the published coverage map (AD-30)
	$(UV) run python scripts/gen_coverage.py
	@$(MAKE) threat-rows
	@$(MAKE) marketing-facts

threat-rows:       ## Regenerate the front's threat rows from the map (L3)
	$(UV) run python scripts/gen_threat_rows.py

marketing-facts:   ## Regenerate the publishable coverage facts (L4)
	$(UV) run python scripts/gen_marketing.py

replays:           ## Regenerate the audit replays from the last test run (L6)
	$(UV) run python scripts/gen_replays.py

migrations-manifest: ## Regenerate the shipped-migrations manifest (FR-167)
	$(UV) run python -c "from core import migrate; migrate.MANIFEST.write_text(migrate.render_manifest(), encoding='utf-8')"
	@echo ">> $(shell pwd)/supabase/migrations/MANIFEST.sha256 regenerated"

verify-frontend:
	@if [ -f frontend/package.json ]; then \
		echo ">> frontend checks (eslint + tsc)"; \
		npm --prefix frontend run lint && npm --prefix frontend run typecheck; \
	else \
		echo ">> frontend not scaffolded yet (M7): eslint/tsc skipped"; \
	fi

demo:              ## End-to-end break-then-control story
	$(UV) run python scripts/demo.py

# ---------------------------------------------------------------------------
# Self-hosted stack (docker-compose.yml): Postgres + migrations + control API.
# No identity provider and no console — see the compose file's header for why.
# ---------------------------------------------------------------------------
up:                ## Build and start the control plane, waiting until it is healthy
	$(COMPOSE) up -d --build --wait
	@echo ">> control API   http://127.0.0.1:$(XSOM_API_PORT)/health/ready"
	@echo ">> port taken?   XSOM_API_PORT=18000 make up   ('make ps' shows the real mapping)"
	@echo ">> console login needs an external JWKS issuer (SUPABASE_URL in .env)"

cli:               ## Run the CLI inside the stack: make cli ARGS="bootstrap --org Acme"
	$(COMPOSE) run --rm --no-deps -e DATABASE_URL migrate python -m cli $(ARGS)

backup:            ## Dump the evidence plane to backup/xsom-<date>.sql.gz
	@mkdir -p backup
	$(COMPOSE) exec -T db pg_dump -U xsom -d xsom --clean --if-exists \
	  | gzip > backup/xsom-$$(date -u +%Y%m%dT%H%M%SZ).sql.gz
	@echo ">> written: $$(ls -t backup/xsom-*.sql.gz | head -1)"
	@echo ">> restore: make restore FILE=<that file>   then re-verify the chain"

restore:           ## Restore a dump, then re-verify the hash chain: make restore FILE=...
	@test -n "$(FILE)" || (echo "usage: make restore FILE=backup/xsom-....sql.gz" && exit 1)
	gzip -dc "$(FILE)" | $(COMPOSE) exec -T db psql -U xsom -d xsom -v ON_ERROR_STOP=1
	@echo ">> restored; verifying the chain survived the round trip"
	$(COMPOSE) run --rm --no-deps -e DATABASE_URL migrate python scripts/verify_chain.py

down:              ## Stop the stack; the database volume (audit chain) survives
	$(COMPOSE) down

down-hard:         ## Stop the stack AND delete the volume — destroys the audit chain
	$(COMPOSE) down --volumes

logs:              ## Follow the stack's logs
	$(COMPOSE) logs -f --tail=100

ps:                ## Show each service and its health
	$(COMPOSE) ps

clean:
	rm -rf .pytest_cache .mypy_cache .ruff_cache .coverage htmlcov coverage.xml
