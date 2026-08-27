"""Control-API routes for observation windows (G-25, AD-27, FR-179).

Enforcement is the default; a window is the bounded, attributed exception. Opening
one is an admin action, not an agent's -- that separation is the whole fix, so it
lives in the route's role requirement rather than in a comment.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from api.deps import database_url, require_tenant
from api.security import get_current_user, require_role
from core import db, monitor
from core.config import Settings
from core.schemas import CurrentUser, MonitorWindowOut, MonitorWindowRequest, Role

router = APIRouter(prefix="/v1/monitor-windows", tags=["monitor"])

# Opening a window relaxes enforcement. Only an admin may: an operator deciding an
# approval is judging one action, an admin opening a window is suspending judgement
# on a whole agent for hours.
_require_admin = require_role(Role.admin)


def _out(window: monitor.Window) -> dict[str, Any]:
    return {
        "id": window.id,
        "gateway_token_id": window.gateway_token_id,
        "opened_at": window.opened_at,
        "expires_at": window.expires_at,
        "closed_at": window.closed_at,
        "opened_by": window.opened_by,
        "closed_by": window.closed_by,
        "active": window.active,
    }


@router.get("", response_model=list[MonitorWindowOut])
def list_windows(
    request: Request, user: CurrentUser = Depends(get_current_user)
) -> list[dict[str, Any]]:
    """Every window, running and historical. History is not noise here: a period
    during which enforcement was relaxed is evidence."""
    tenant_id = require_tenant(user)
    with db.connection(database_url(request)) as conn:
        return [_out(w) for w in monitor.list_windows(conn, tenant_id)]


@router.post("", response_model=MonitorWindowOut, status_code=status.HTTP_201_CREATED)
def open_window(
    payload: MonitorWindowRequest,
    request: Request,
    user: CurrentUser = Depends(_require_admin),
) -> dict[str, Any]:
    """Open a window on one agent, or extend the one already running."""
    tenant_id = require_tenant(user)
    settings: Settings = request.app.state.settings
    with db.connection(database_url(request)) as conn:
        try:
            window, _extended = monitor.open_window(
                conn,
                tenant_id=tenant_id,
                gateway_token_id=payload.gateway_token_id,
                hours=payload.hours,
                max_hours=settings.monitor_max_hours,
                opened_by=user.user_id,
            )
        except monitor.MonitorError as exc:
            # The message names the ceiling; a generic 422 teaches an admin nothing.
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        conn.commit()
        return _out(window)


@router.delete("/{window_id}", response_model=MonitorWindowOut)
def close_window(
    window_id: int, request: Request, user: CurrentUser = Depends(_require_admin)
) -> dict[str, Any]:
    """Stop a window now. Enforcement resumes on the next call; the row stays."""
    tenant_id = require_tenant(user)
    with db.connection(database_url(request)) as conn:
        window = monitor.close_window(
            conn, tenant_id=tenant_id, window_id=window_id, closed_by=user.user_id
        )
        conn.commit()
    if window is None:
        raise HTTPException(status_code=404, detail="no such open window")
    return _out(window)
