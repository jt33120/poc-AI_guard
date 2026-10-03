"""Read-only organization and product access for the authenticated console."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from api.deps import database_url, require_tenant
from api.security import get_current_user
from core import db
from core.schemas import CurrentUser, Role

router = APIRouter(prefix="/v1/workspace", tags=["workspace"])


@router.get("")
def workspace(request: Request, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    tenant = require_tenant(user)
    with db.tenant_reader(
        database_url(request), user_id=user.user_id, tenant_id=tenant, role=user.role or Role.viewer
    ) as conn:
        organization = conn.execute(
            "select id, name from tenants where id = %s", (tenant,)
        ).fetchone()
        if organization is None:
            raise HTTPException(status_code=404, detail="Organization not found")
        rows = conn.execute(
            "select product, case when ends_at <= now() "
            "and status in ('active','trial','internal') "
            "then 'expired' else status end, edition, seats, ends_at "
            "from tenant_product_access order by product"
        ).fetchall()
    subscriptions = {
        row[0]: {
            "product": row[0],
            "status": row[1],
            "edition": row[2],
            "seats": row[3],
            "ends_at": row[4].isoformat() if row[4] else None,
        }
        for row in rows
    }
    return {
        "organization": {"id": str(organization[0]), "name": organization[1]},
        "subscriptions": [
            subscriptions.get(
                product,
                {
                    "product": product,
                    "status": "unconfigured",
                    "edition": None,
                    "seats": None,
                    "ends_at": None,
                },
            )
            for product in ("secret_guard", "ai_guard")
        ],
    }
