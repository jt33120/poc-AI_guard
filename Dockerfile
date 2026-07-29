# Control API image for container hosts (Railway / Render / Fly) and for the
# one-shot migrate service of docker-compose.yml — the same image serves both, so
# a deployment can never run an API build against a schema from another build.
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

# Application source. The whole build context lands here on purpose: the image
# has to carry supabase/migrations + core/migrate.py so the migrate service can
# migrate the database it is about to serve, and an explicit COPY list silently
# drops every package added afterwards (that is exactly how `supabase` and
# `scripts` went missing). What may ship is decided in one place — .dockerignore,
# whose first section is the "never ship" deny-list.
COPY . .

ENV PATH="/opt/venv/bin:$PATH"

# Run unprivileged (CLAUDE.md §4 — least privilege).
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000
# Railway / Render inject $PORT; default to 8000 for local `docker run`.
# `python -m uvicorn` keeps the working dir on sys.path so `api.main` imports.
CMD ["sh", "-c", "python -m uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
