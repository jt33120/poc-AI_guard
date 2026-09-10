"""Hardened control API (FastAPI).

Hardening (CLAUDE.md §4.8/§4.9):
  * ``debug=False`` always.
  * ``/docs`` & ``/redoc`` disabled when ``ENV=prod``.
  * Explicit CORS allowlist (no wildcard — enforced in ``core.config``).
  * Security response headers on every response.
  * Generic error handler (no stack traces to the client).

Routes land milestone by milestone. M0 exposes only ``GET /health``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from enum import StrEnum

from fastapi import APIRouter, Depends, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from api.agents import router as agents_router
from api.ai import router as ai_router
from api.approvals import router as approvals_router
from api.audit import router as audit_router
from api.authorize import router as authorize_router
from api.clients import router as clients_router
from api.compliance import router as compliance_router
from api.corpora import router as corpora_router
from api.credentials import router as credentials_router
from api.deps import requires
from api.dlp import router as dlp_router
from api.errors import register_exception_handlers
from api.gateway_tokens import router as gateway_tokens_router
from api.health import router as health_router
from api.integrity import router as integrity_router
from api.llm_proxy import router as llm_proxy_router
from api.monitor import router as monitor_router
from api.policy import router as policy_router
from api.promotion import router as promotion_router
from api.ratelimit import limiter
from api.read_tokens import router as read_tokens_router
from api.security import build_federation, build_verifier, get_current_user
from api.servers import router as servers_router
from api.shadow_ai import router as shadow_ai_router
from api.signup import router as signup_router
from api.threats import router as threats_router
from api.triage import router as triage_router
from api.trust import router as trust_router
from api.usage import router as usage_router
from api.verdicts import router as verdicts_router
from core.config import Settings, get_settings
from core.entitlements import Capability
from core.logging import configure_logging
from core.observability import init_observability
from core.prompt_guard import build_guard
from core.schemas import CurrentUser
from core.signup import build_auth_admin

_SECURITY_HEADERS: dict[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "X-Permitted-Cross-Domain-Policies": "none",
    "Cache-Control": "no-store",
}


class Plane(StrEnum):
    """Le plan qu'un déploiement sert.

    Une seule application montait les vingt-six routeurs, et ils n'ont pas le même
    métier. `/v1/authorize` est appelé par l'agent à **chaque appel d'outil** ; le
    proxy l'est à chaque appel de modèle. Le reste est appelé par un humain devant
    une console, par à-coups.

    Les mêler dans un processus revient à faire dépendre l'autorisation de tous les
    agents de la santé de l'écran d'export de conformité : un déploiement raté sur
    un routeur de console arrêtait la flotte entière. La règle 4 de `CLAUDE.md` veut
    qu'une action refusée n'ait pas lieu — pas que tout s'arrête parce que la console
    a planté.

    `ALL` reste le défaut et monte tout : c'est ce que lancent le développement
    local, `make demo` et les tests, et c'est ce qui rend ce découpage réversible.
    """

    ALL = "all"
    DECISION = "decision"
    LLM = "llm"
    CONSOLE = "console"


#: Monté par tous les plans. La sonde de disponibilité en fait partie : chaque
#: service Railway a son propre healthcheck, et un plan qui ne répondrait pas
#: serait redémarré en boucle.
_SOCLE: tuple[APIRouter, ...] = (health_router,)

#: Le plan qui sert chaque routeur.
#:
#: Cette table est la **seule** source de `create_app` : un routeur qui n'y figure
#: pas n'est servi par aucun plan, y compris `ALL`. C'est délibéré — l'oubli se voit
#: alors en test plutôt que de se traduire par une route qui répond depuis le
#: mauvais service. `tests/test_api_planes.py` refuse d'ailleurs la construction si
#: un module d'`api/` expose un `router` absent d'ici.
_PLANS: dict[Plane, tuple[APIRouter, ...]] = {
    Plane.DECISION: (authorize_router,),
    Plane.LLM: (llm_proxy_router,),
    Plane.CONSOLE: (
        servers_router,
        policy_router,
        approvals_router,
        audit_router,
        gateway_tokens_router,
        agents_router,
        usage_router,
        credentials_router,
        clients_router,
        dlp_router,
        ai_router,
        read_tokens_router,
        compliance_router,
        integrity_router,
        monitor_router,
        promotion_router,
        trust_router,
        corpora_router,
        verdicts_router,
        shadow_ai_router,
        threats_router,
        triage_router,
        signup_router,
    ),
}


#: La capacité de gamme qu'un routeur exige, ou `None` s'il est libre.
#:
#: **Écrite routeur par routeur, `None` compris.** Un routeur absent de cette table
#: fait échouer la construction (`tests/test_entitlements_map.py`), parce que le mode
#: de panne est silencieux dans les deux sens : un `requires` oublié laisse une
#: fonctionnalité payante gratuite pour tout le monde, indéfiniment, sans que rien ne
#: casse — et aucun test écrit après coup ne le trouve, puisqu'il n'y a rien à
#: trouver : le code fait ce qu'il a toujours fait.
#:
#: **Le routeur et pas la route.** Une route ajoutée demain dans `api/dlp.py` est
#: verrouillée par construction, pas parce que quelqu'un s'en est souvenu.
#:
#: Les `None` sont des décisions, pas des oublis, et chacun porte sa raison.
_CAPACITE_PAR_ROUTEUR: tuple[tuple[APIRouter, Capability | None], ...] = (
    # --- Le socle qui ne se vend pas ---------------------------------------------
    (health_router, None),  # une sonde derrière un paywall ne sert à rien
    (signup_router, None),  # on ne peut pas exiger un palier avant d'avoir un tenant
    (threats_router, None),  # contenu public : c'est le site
    (authorize_router, None),  # §4.1 — le verdict est la garantie, il ne se facture pas
    (approvals_router, None),  # §4.1 — tenir un humain dans la boucle non plus
    (audit_router, None),  # §4.2 — le journal prouve ; le facturer serait vendre le risque
    (policy_router, None),  # sans policy éditable, le produit ne fait rien
    (trust_router, None),  # lecture du capital de confiance, adossée à l'audit
    # --- Les capacités de gamme ---------------------------------------------------
    (llm_proxy_router, Capability.llm_proxy),
    (gateway_tokens_router, Capability.agents_inventory),
    (agents_router, Capability.agents_inventory),
    (servers_router, Capability.agents_inventory),
    (usage_router, Capability.usage_billing),
    (triage_router, Capability.triage),
    (credentials_router, Capability.credentials),
    (clients_router, Capability.clients),
    (dlp_router, Capability.dlp_config),
    (ai_router, Capability.ai_summary),
    (read_tokens_router, Capability.read_tokens),
    (compliance_router, Capability.compliance_pack),
    (integrity_router, Capability.integrity_admin),
    (monitor_router, Capability.monitor_admin),
    (promotion_router, Capability.promotion),
    (corpora_router, Capability.corpora),
    (verdicts_router, Capability.verdicts_ingest),
    (shadow_ai_router, Capability.shadow_ai),
)


#: Ce qu'un plan chaud a le **droit** de servir, préfixe par préfixe.
#:
#: Énoncé en liste blanche, et non par comparaison avec la console : un routeur
#: *déplacé* de la console vers un plan chaud n'est plus dans la console, si bien
#: qu'une comparaison ne trouve rien à signaler. Éprouvé — la première version de
#: `tests/test_api_planes.py` était formulée ainsi, et laissait passer `audit_router`
#: dans le plan `décision` sans qu'aucun des onze contrôles ne bronche.
_PREFIXES_CHAUDS: dict[Plane, tuple[str, ...]] = {
    Plane.DECISION: ("/v1/authorize",),
    Plane.LLM: ("/proxy/",),
}

#: Servi par tous les plans : les deux sondes, et le principal authentifié.
_CHEMINS_SOCLE: frozenset[str] = frozenset({"/health", "/health/ready", "/v1/me"})


def _capacite_de(router: APIRouter) -> Capability | None:
    """La capacité qu'un routeur exige, cherchée par **identité**.

    Une table `dict[APIRouter, ...]` serait plus naturelle et ne compile pas :
    `APIRouter` n'est pas hachable. `_PLANS` contourne déjà la même limite avec des
    tuples, et `tests/test_api_planes.py` compare par `id()` pour la même raison.
    Vingt-six entrées parcourues une fois au montage : le coût est nul, et l'écriture
    reste une table qu'on lit d'un coup d'œil.
    """
    for declare, capacite in _CAPACITE_PAR_ROUTEUR:
        if declare is router:
            return capacite
    return None


def routers_for(plane: Plane) -> tuple[APIRouter, ...]:
    """Les routeurs d'un plan, socle compris."""
    if plane is Plane.ALL:
        servis = tuple(r for routeurs in _PLANS.values() for r in routeurs)
    else:
        servis = _PLANS[plane]
    return _SOCLE + servis


def create_app(settings: Settings | None = None, *, plane: Plane = Plane.ALL) -> FastAPI:
    """Build a hardened FastAPI app. Tests may inject a custom ``Settings``.

    ``plane`` choisit les routeurs montés ; par défaut, tous.
    """
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    init_observability(settings)

    app = FastAPI(
        title=settings.app_name if plane is Plane.ALL else f"{settings.app_name} · {plane.value}",
        version="0.1.0",
        debug=False,
        # Disable interactive docs in production (CLAUDE.md §4.8).
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url="/redoc" if settings.docs_enabled else None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
    )

    # Explicit CORS allowlist (wildcard rejected in core.config).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def _security_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        for header, value in _SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)
        return response

    register_exception_handlers(app)

    # Shared state read by dependencies (settings, verifier, DB url, limiter).
    app.state.settings = settings
    # Le plan servi, pour que la sonde de disponibilité sache ce que CE service a
    # besoin de savoir faire. `health_router` est dans le socle, donc les trois plans
    # servaient jusqu'ici le même verdict — et un plan qui échoue sur une dépendance
    # qu'il n'appelle jamais sort de la rotation pour rien.
    app.state.plane = plane
    app.state.verifier = build_verifier(settings)
    # `FR-196` : construite au démarrage, pour qu'une correspondance groupe→rôle
    # malformée refuse de démarrer au lieu de 500 au premier login.
    app.state.federation = build_federation(settings)
    app.state.auth_admin = build_auth_admin(settings)
    app.state.database_url = settings.database_url
    app.state.limiter = limiter
    # `FR-193` : `None` quand le garde-prompt n'est pas activé, et le proxy le lit
    # ainsi. Un garde éteint ne change aucun verdict — il n'est sur le chemin d'aucune
    # décision — mais il change ce que l'Evidence Pack a le droit d'attester.
    app.state.prompt_guard = build_guard(settings)
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, str]:
        """Liveness probe: this process is up. Unchanged, static, unauthenticated.

        Readiness — can it actually serve? — is a different question and lives in
        :mod:`api.health`, because a probe that touches the database must never be
        what a load balancer restarts a healthy process over.
        """
        return {"status": "ok"}

    @app.get("/v1/me", tags=["auth"])
    async def me(user: CurrentUser = Depends(get_current_user)) -> dict[str, str | None]:
        """Return the authenticated principal (protected route, requires JWT)."""
        return {
            "user_id": user.user_id,
            "tenant_id": user.tenant_id,
            "role": user.role.value if user.role else None,
        }

    for router in routers_for(plane):
        capacite = _capacite_de(router)
        app.include_router(router, dependencies=[Depends(requires(capacite))] if capacite else [])

    return app


app = create_app()
