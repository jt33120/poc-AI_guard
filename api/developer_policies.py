"""Console and workstation policy distribution routes."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from api.deps import database_url, require_tenant
from api.gateway_auth import GatewayPrincipal, get_gateway_principal
from api.security import get_current_user, require_role
from core import db, developer_approvals, developer_policies, extension_devices
from core.schemas import CurrentUser, Role

router = APIRouter(tags=["developer-policies"])
console_router = APIRouter(prefix="/v1/developer-policies", tags=["developer-policies"])
_admin = require_role(Role.admin)


class DeveloperApprovalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID = Field(alias="requestId")
    policy_id: str = Field(alias="policyId", min_length=1, max_length=128)
    policy_version: int = Field(alias="policyVersion", ge=1)
    action_binding: str = Field(alias="actionBinding", pattern=r"^[a-f0-9]{64}$")
    tool_name: str = Field(alias="toolName", pattern=r"^[A-Za-z0-9._-]{1,128}$")
    action_class: Literal[
        "read",
        "write",
        "delete",
        "publish",
        "deploy",
        "network",
        "security",
        "mcp",
        "unknown",
    ] = Field(alias="actionClass")


class DeveloperApprovalConsume(BaseModel):
    model_config = ConfigDict(extra="forbid")

    policy_id: str = Field(alias="policyId", min_length=1, max_length=128)
    policy_version: int = Field(alias="policyVersion", ge=1)
    action_binding: str = Field(alias="actionBinding", pattern=r"^[a-f0-9]{64}$")


@console_router.get("")
def list_policies(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
) -> list[dict[str, Any]]:
    tenant = require_tenant(user)
    with db.tenant_reader(
        database_url(request),
        user_id=user.user_id,
        tenant_id=tenant,
        role=user.role or Role.viewer,
    ) as conn:
        return developer_policies.list_for_tenant(conn, tenant)


@console_router.put("/{policy_id}")
def publish_policy(
    policy_id: str,
    payload: developer_policies.DeveloperPolicyBody,
    request: Request,
    user: CurrentUser = Depends(_admin),
) -> dict[str, Any]:
    if payload.policy_id != policy_id:
        raise HTTPException(status_code=422, detail="policy id mismatch")
    tenant = require_tenant(user)
    try:
        signing = developer_policies.signer(request.app.state.settings)
    except developer_policies.DeveloperPolicyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from None
    try:
        with db.connection(database_url(request)) as conn:
            envelope = developer_policies.publish(
                conn,
                tenant_id=tenant,
                body=payload,
                signing=signing,
                published_by=user.user_id,
            )
            conn.commit()
        return envelope
    except developer_policies.PolicyVersionConflict as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from None
    except developer_policies.DeveloperPolicyError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from None


@console_router.post("/{policy_id}/assign/{device_id}", status_code=204)
def assign_policy(
    policy_id: str,
    device_id: str,
    request: Request,
    user: CurrentUser = Depends(_admin),
) -> None:
    tenant = require_tenant(user)
    with db.connection(database_url(request)) as conn:
        try:
            developer_policies.assign(
                conn,
                tenant_id=tenant,
                device_id=device_id,
                policy_id=policy_id,
            )
        except LookupError as exc:
            label = "Device" if str(exc) == "device_not_found" else "Policy"
            raise HTTPException(status_code=404, detail=f"{label} not found") from None
        conn.commit()


@console_router.delete("/{policy_id}", status_code=204)
def revoke_policy(policy_id: str, request: Request, user: CurrentUser = Depends(_admin)) -> None:
    tenant = require_tenant(user)
    with db.connection(database_url(request)) as conn:
        if not developer_policies.revoke(conn, tenant, policy_id):
            raise HTTPException(status_code=404, detail="Policy not found")
        conn.commit()


@router.get("/v1/extension/policy")
def workstation_policy(
    request: Request,
    principal: GatewayPrincipal = Depends(get_gateway_principal),
) -> dict[str, Any]:
    with db.connection(database_url(request)) as conn:
        try:
            device_id = extension_devices.device_for(conn, principal.tenant_id, principal.token_id)
        except LookupError:
            raise HTTPException(status_code=404, detail="Device not registered") from None
        result = developer_policies.current_for_device(conn, principal.tenant_id, device_id)
    if result is None:
        raise HTTPException(status_code=404, detail="No active policy assigned")
    return result


def _device_id(conn: Any, principal: GatewayPrincipal) -> str:
    try:
        return extension_devices.device_for(conn, principal.tenant_id, principal.token_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Device not registered") from None


@router.post("/v1/extension/approvals/request", status_code=status.HTTP_201_CREATED)
def request_workstation_approval(
    payload: DeveloperApprovalRequest,
    request: Request,
    principal: GatewayPrincipal = Depends(get_gateway_principal),
) -> dict[str, Any]:
    with db.connection(database_url(request)) as conn:
        try:
            result = developer_approvals.request(
                conn,
                tenant_id=principal.tenant_id,
                device_id=_device_id(conn, principal),
                request_id=str(payload.request_id),
                policy_id=payload.policy_id,
                policy_version=payload.policy_version,
                action_binding=payload.action_binding,
                tool_name=payload.tool_name,
                action_class=payload.action_class,
            )
            conn.commit()
            return result
        except LookupError:
            raise HTTPException(status_code=409, detail="Policy is no longer assigned") from None
        except ValueError:
            raise HTTPException(
                status_code=409, detail="Approval request binding conflict"
            ) from None


@router.post("/v1/extension/approvals/{approval_id}/consume")
def consume_workstation_approval(
    approval_id: UUID,
    payload: DeveloperApprovalConsume,
    request: Request,
    principal: GatewayPrincipal = Depends(get_gateway_principal),
) -> dict[str, Any]:
    with db.connection(database_url(request)) as conn:
        result = developer_approvals.consume_if_approved(
            conn,
            tenant_id=principal.tenant_id,
            device_id=_device_id(conn, principal),
            approval_id=str(approval_id),
            policy_id=payload.policy_id,
            policy_version=payload.policy_version,
            action_binding=payload.action_binding,
        )
        conn.commit()
    if result is None:
        raise HTTPException(status_code=404, detail="Approval not found")
    return result
