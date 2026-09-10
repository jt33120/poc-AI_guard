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

import threading
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

#: Borne côté serveur sur la requête de la sonde, en millisecondes.
#:
#: `connect_timeout` ne borne que **l'établissement** de la connexion. Une base qui
#: accepte la connexion puis ne répond plus — le mode de panne le plus courant d'un
#: Postgres saturé — laissait la sonde attendre indéfiniment dans un thread du pool,
#: et la sonde est ce sur quoi Railway décide de redémarrer. `grep statement_timeout`
#: sur `core/`, `api/` et `gateway/` ne rendait rien, nulle part.
_DB_STATEMENT_TIMEOUT_MS = 2000

#: Un seul calcul à la fois. La mémoïsation lisait puis écrivait `state.readiness`
#: sans verrou, dans une fonction synchrone donc exécutée dans le pool de threads :
#: N requêtes simultanées sur une route anonyme et non limitée ouvraient N connexions
#: sur le DSN qu'utilise aussi le chemin de décision. Le docstring du module promet
#: pourtant que la sonde ne peut pas servir d'amplificateur.
_VERROU = threading.Lock()

#: Les plans dont une route lit un JWT. Nommés en dur plutôt que déduits de
#: `api.main`, pour ne pas créer d'import circulaire : `api/main.py` importe déjà ce
#: module. `tests/test_health.py` confronte cette liste aux plans réels, donc elle ne
#: peut pas dériver en silence.
_PLANS_QUI_VERIFIENT_UN_JETON = frozenset({"all", "console"})


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
        with psycopg.connect(
            dsn,
            connect_timeout=_DB_CONNECT_TIMEOUT,
            options=f"-c statement_timeout={_DB_STATEMENT_TIMEOUT_MS}",
        ) as conn:
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


def evaluate(settings: Settings, plane: str = "all") -> Readiness:
    """Run every gate and decide the single boolean a probe keys on.

    **Le plan compte, et il ne comptait pas.** `health_router` est dans le socle, donc
    les trois services — `décision`, `proxy LLM`, `console` — servaient exactement le
    même verdict. Or le plan `décision` ne vérifie aucun JWT : `api/authorize.py`
    authentifie par `X-Gateway-Token`, et `api/decision.py` dit explicitement que ce
    plan n'a besoin ni de la clé `service_role` ni des identifiants de fournisseurs.

    Conséquence : une panne JWKS, ou un projet Supabase en pause, sortait
    `/v1/authorize` de la rotation pour une dépendance qu'il n'appelle jamais — et un
    agent coopératif privé de verdict refuse tout en fail-closed. C'est exactement la
    cascade que le découpage en plans existe pour empêcher, réintroduite par la sonde.

    Le booléen `issuer` reste dans la charge pour **tous** les plans : il est
    informatif, et le retirer rendrait le diagnostic plus pauvre. Seul le rollup
    change.
    """
    database, schema_current = _database_gates(settings.database_url)
    # Deux conditions, pas une. Que le JWKS résolve dit seulement qu'un émetteur
    # répond ; qu'il serve *nos* revendications dit qu'un jeton pourra autoriser
    # quelque chose. Un émetteur étranger satisfaisait la première et jamais la
    # seconde, et la sonde le déclarait vert (`FR-195`).
    issuer = _issuer_resolves(settings.jwks_url) and settings.issuer_serves_our_claims
    # A configured issuer that does not resolve is fatal: no token can be
    # verified, so every authenticated route is dead. An issuer that is not
    # configured at all is only fatal in prod — the control-plane-only stack
    # (gateway tokens, /v1/authorize, migrations, audit) genuinely works without
    # one, and a probe that can never go green is a probe operators switch off.
    issuer_required = (
        settings.is_prod or settings.jwks_url is not None
    ) and plane in _PLANS_QUI_VERIFIENT_UN_JETON
    return Readiness(
        ok=database and schema_current and (issuer or not issuer_required),
        database=database,
        schema_current=schema_current,
        issuer=issuer,
    )


def _frais(state: State) -> Readiness | None:
    """Le verdict mémoïsé s'il est encore valable, sinon ``None``."""
    cached: _Cached | None = getattr(state, "readiness", None)
    if cached is not None and time.monotonic() - cached.at < _CACHE_TTL_SECONDS:
        return cached.verdict
    return None


def _cached_verdict(state: State) -> Readiness:
    """Memoise per app instance (not per process: tests build many apps)."""
    if (verdict := _frais(state)) is not None:
        return verdict
    # Le verrou n'est pris qu'au **défaut de cache**, et l'entrée est relue une fois
    # dedans : le chemin chaud reste sans verrou, et les N requêtes qui arrivent
    # pendant un calcul en cours attendent celui-ci au lieu d'en lancer N autres.
    with _VERROU:
        if (verdict := _frais(state)) is not None:
            return verdict
        plan: str = getattr(state, "plane", "all")
        verdict = evaluate(state.settings, plan)
        state.readiness = _Cached(verdict=verdict, at=time.monotonic())
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
