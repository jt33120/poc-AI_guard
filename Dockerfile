# Control API image for container hosts (Railway / Render / Fly).
# NOTE: the MCP *gateway* runs over stdio beside an agent — it is NOT served here.
# Only the hardened FastAPI control API (api.main:app) is exposed.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app

# Dependency layer — cached until pyproject.toml / uv.lock change.
# `[tool.uv] package = false` => uv installs only the locked dependencies.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Application source (the control API and its libraries only).
COPY core ./core
COPY api ./api
COPY gateway ./gateway

ENV PATH="/opt/venv/bin:$PATH"

# Run unprivileged (CLAUDE.md §4 — least privilege).
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000
# Railway / Render inject $PORT; default to 8000 for local `docker run`.
# `python -m uvicorn` keeps the working dir on sys.path so `api.main` imports.
CMD ["sh", "-c", "python -m uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
