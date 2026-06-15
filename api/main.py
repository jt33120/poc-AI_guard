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

from fastapi import Depends, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from api.errors import register_exception_handlers
from api.security import build_verifier, get_current_user
from core.config import Settings, get_settings
from core.logging import configure_logging
from core.observability import init_observability
from core.schemas import CurrentUser

_SECURITY_HEADERS: dict[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "X-Permitted-Cross-Domain-Policies": "none",
    "Cache-Control": "no-store",
}


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build a hardened FastAPI app. Tests may inject a custom ``Settings``."""
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    init_observability(settings)

    app = FastAPI(
        title=settings.app_name,
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

    # Token verifier for auth dependencies (read via request.app.state).
    app.state.verifier = build_verifier(settings)

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, str]:
        """Liveness probe — the only unauthenticated route (SPEC §8)."""
        return {"status": "ok"}

    @app.get("/v1/me", tags=["auth"])
    async def me(user: CurrentUser = Depends(get_current_user)) -> dict[str, str | None]:
        """Return the authenticated principal (protected route, requires JWT)."""
        return {
            "user_id": user.user_id,
            "tenant_id": user.tenant_id,
            "role": user.role.value if user.role else None,
        }

    return app


app = create_app()
