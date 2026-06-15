"""Small shared dependencies for control-API routers."""

from __future__ import annotations

from fastapi import HTTPException, Request, status

from core.schemas import CurrentUser


def database_url(request: Request) -> str:
    url: str | None = request.app.state.database_url
    if not url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database not configured"
        )
    return url


def require_tenant(user: CurrentUser) -> str:
    if not user.tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenant in token")
    return user.tenant_id
