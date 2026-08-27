# xSOM AI Guard — task runner (CLAUDE.md §8).
# Canonical targets: dev / test / verify / demo. Compose targets: up / down / logs.
UV ?= uv
COMPOSE ?= docker compose
# Mirrors the defaults in docker-compose.yml, for the URLs printed by `make up`.
XSOM_API_PORT ?= 8000

.PHONY: install frontend-install dev test verify demo lint fmt fmt-check typecheck audit \
        coverage-gate coverage-map verify-frontend test-frontend clean up down down-hard logs ps

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

# verify = ruff + mypy + tests + audit_security (+ eslint/tsc when frontend exists).
# CLAUDE.md §8. Frontend checks are skipped cleanly until M7 scaffolds frontend/.
verify: lint fmt-check typecheck test audit coverage-gate verify-frontend
	@echo ">> verify: OK"

coverage-gate:     ## CM-7: every `Bloqué` claim is backed by a passing scenario
	$(UV) run python scripts/gen_coverage.py --check

coverage-map:      ## Regenerate the published coverage map (AD-30)
	$(UV) run python scripts/gen_coverage.py

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
