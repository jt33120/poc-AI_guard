# xSOM AI Guard — task runner (CLAUDE.md §8).
# Canonical targets: dev / test / verify / demo.
UV ?= uv

.PHONY: install dev test verify demo lint fmt fmt-check typecheck audit verify-frontend clean

install:           ## Install deps into the project venv
	$(UV) sync

dev:               ## Run control API (gateway MCP runs over stdio; front lands in M7)
	@echo ">> control API on http://localhost:8000 (gateway MCP: stdio, see gateway/server.py)"
	$(UV) run uvicorn api.main:app --reload --port 8000

test:              ## Run the test suite (Playwright smoke added in M7)
	$(UV) run pytest

lint:              ## ruff lint
	$(UV) run ruff check .

fmt:               ## ruff auto-format
	$(UV) run ruff format .

fmt-check:         ## ruff format check (CI/verify)
	$(UV) run ruff format --check .

typecheck:         ## mypy strict over source packages
	$(UV) run mypy core api gateway scripts

audit:             ## Static security audit (fails on CRITICAL)
	$(UV) run python scripts/audit_security.py

# verify = ruff + mypy + tests + audit_security (+ eslint/tsc when frontend exists).
# CLAUDE.md §8. Frontend checks are skipped cleanly until M7 scaffolds frontend/.
verify: lint fmt-check typecheck test audit verify-frontend
	@echo ">> verify: OK"

verify-frontend:
	@if [ -f frontend/package.json ]; then \
		echo ">> frontend checks (eslint + tsc)"; \
		npm --prefix frontend run lint && npm --prefix frontend run typecheck; \
	else \
		echo ">> frontend not scaffolded yet (M7): eslint/tsc skipped"; \
	fi

demo:              ## End-to-end break-then-control story (implemented in M8)
	@echo ">> make demo is implemented in M8 (see docs/BUILD_PLAN.md)."

clean:
	rm -rf .pytest_cache .mypy_cache .ruff_cache .coverage htmlcov coverage.xml
