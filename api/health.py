"""Readiness probe — separate from liveness, and honest about what is broken.

``GET /health`` (declared in :mod:`api.main`) stays what it was: a static,
unauthenticated liveness answer. Readiness answers a different question — *can
this deployment serve at all?* — so it has to reach the database, and a load
balancer or a compose healthcheck needs it to go red when the answer is no.

The payload is booleans only. Readiness is unauthenticated, so anything richer
is disclosure: a capability map ("dlp off, anchors unconfigured") tells an
anonymous caller which deployment is worth attacking, which is why capabilities
belong behind ``require_role`` and not here (PLAN-REVIEW INV-11). No DSN, no
hostname, no version, no error text ever leaves this module (CLAUDE.md §4.8).
The verdict is memoised for a few seconds so the probe cannot be used as an
anonymous database or JWKS amplifier.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx
import psycopg
from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel
from starlette.datastructures import State

from core import migrate
from core.config import Settings

router = APIRouter(tags=["meta"])

# Long enough to absorb a healthcheck loop and a load balancer, short enough that
# an operator watching `docker compose up --wait` sees the stack turn green.
_CACHE_TTL_SECONDS = 5.0
_DB_CONNECT_TIMEOUT = 3  # seconds; psycopg takes an int
_JWKS_TIMEOUT = 3.0


class Readiness(BaseModel):
    """The boot gates, as verdicts. Never carries a value, only a boolean."""

    ok: bool
    database: bool
    schema_current: bool
    issuer: bool


@dataclass(frozen=True)
class _Cached:
    verdict: Readiness
    at: float


def _database_gates(dsn: str | None) -> tuple[bool, bool]:
    """Return (database reachable, schema at the bundled head).

    Fail-closed: an unset DSN, a refused connection, a permission error or a
    missing ledger are all "not ready" — never a skipped check.
    """
    if not dsn:
        return False, False
    try:
        with psycopg.connect(dsn, connect_timeout=_DB_CONNECT_TIMEOUT) as conn:
            return True, not migrate.pending(conn)
    except (psycopg.Error, OSError):
        return False, False


def _issuer_resolves(url: str | None) -> bool:
    """True when the configured JWKS endpoint serves a key set right now."""
    if not url:
        return False
    try:
        response = httpx.get(url, timeout=_JWKS_TIMEOUT)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return False
    return bool(isinstance(payload, dict) and payload.get("keys"))


def evaluate(settings: Settings) -> Readiness:
    """Run every gate and decide the single boolean a probe keys on."""
    database, schema_current = _database_gates(settings.database_url)
    issuer = _issuer_resolves(settings.jwks_url)
    # A configured issuer that does not resolve is fatal: no token can be
    # verified, so every authenticated route is dead. An issuer that is not
    # configured at all is only fatal in prod — the control-plane-only stack
    # (gateway tokens, /v1/authorize, migrations, audit) genuinely works without
    # one, and a probe that can never go green is a probe operators switch off.
    issuer_required = settings.is_prod or settings.jwks_url is not None
    return Readiness(
        ok=database and schema_current and (issuer or not issuer_required),
        database=database,
        schema_current=schema_current,
        issuer=issuer,
    )


def _cached_verdict(state: State) -> Readiness:
    """Memoise per app instance (not per process: tests build many apps)."""
    cached: _Cached | None = getattr(state, "readiness", None)
    now = time.monotonic()
    if cached is not None and now - cached.at < _CACHE_TTL_SECONDS:
        return cached.verdict
    verdict = evaluate(state.settings)
    state.readiness = _Cached(verdict=verdict, at=now)
    return verdict


@router.get("/health/ready")
def ready(request: Request, response: Response) -> Readiness:
    """Readiness: 200 when this deployment can serve, 503 with the failing gate.

    Synchronous on purpose — the database and JWKS probes block, so FastAPI runs
    this in a worker thread instead of stalling the event loop.
    """
    verdict = _cached_verdict(request.app.state)
    if not verdict.ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return verdict
