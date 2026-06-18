"""Public self-serve signup: provision a tenant + admin user (SaaS onboarding).

Rate-limited and unauthenticated. The Supabase Auth Admin client is built from
settings at startup (service-role key, backend-only) and injected via app state
so the flow is testable. Disabled (503) if signup is not configured.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, status

from api.deps import database_url
from api.ratelimit import limiter, signup_rate_limit
from core import db, signup
from core.schemas import SignupRequest

router = APIRouter(prefix="/v1/signup", tags=["signup"])


@router.post("", status_code=status.HTTP_201_CREATED)
@limiter.limit(signup_rate_limit)
def create_account(payload: SignupRequest, request: Request) -> dict[str, Any]:
    admin: signup.AuthAdmin | None = request.app.state.auth_admin
    if admin is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Signup is not enabled"
        )
    with db.connection(database_url(request)) as conn:
        try:
            result = signup.provision_account(
                conn, admin, org=payload.org, email=payload.email, password=payload.password
            )
        except signup.AccountExists:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists",
            ) from None
        except signup.SignupError:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not create the account",
            ) from None
    return {"ok": True, "tenant_id": result["tenant_id"]}
