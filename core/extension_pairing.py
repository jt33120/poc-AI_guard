"""Short-lived, browser-confirmed workstation enrollment. No raw credential storage."""

from __future__ import annotations

import secrets
from typing import Any

import psycopg
from pydantic import BaseModel, ConfigDict, Field

from core.extension_devices import Registration
from core.tenant_tokens import hash_token


class PairingStart(Registration):
    credential_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class PairingApproval(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    code: str = Field(pattern=r"^[A-Z2-9]{5}-[A-Z2-9]{5}$")
    name: str = Field(min_length=1, max_length=80, pattern=r"^[^\x00-\x1f\x7f]+$")
    member_label: str = Field(default="", max_length=100, pattern=r"^[^\x00-\x1f\x7f]*$")
    team: str = Field(default="", max_length=80, pattern=r"^[^\x00-\x1f\x7f]*$")


def start(conn: psycopg.Connection, data: PairingStart) -> dict[str, Any]:
    # Bounded storage, including when the public endpoint is attacked or abandoned.
    conn.execute("select pg_advisory_xact_lock(hashtext('extension-pairing-start'))")
    conn.execute("delete from extension_pairings where expires_at <= now()")
    count = conn.execute("select count(*) from extension_pairings").fetchone()
    if count and count[0] >= 2000:
        raise OverflowError("pairing_capacity")
    code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(10))
    code = f"{code[:5]}-{code[5:]}"
    row = conn.execute(
        "insert into extension_pairings "
        "(code_hash,credential_hash,installation_id,platform,extension_version,mode) "
        "values (%s,%s,%s,%s,%s,%s) returning expires_at",
        (
            hash_token(code),
            data.credential_hash,
            data.installation_id,
            data.platform,
            data.extension_version,
            data.mode,
        ),
    ).fetchone()
    if row is None:  # pragma: no cover - INSERT RETURNING always supplies the row
        raise RuntimeError("Missing pairing row")
    return {"code": code, "expires_at": row[0].isoformat(), "interval": 5}


def inspect(conn: psycopg.Connection, code: str) -> dict[str, Any]:
    row = conn.execute(
        "select platform,extension_version,expires_at from extension_pairings "
        "where code_hash=%s and expires_at>now() and approved_tenant_id is null",
        (hash_token(code),),
    ).fetchone()
    if not row:
        raise LookupError("pairing_unavailable")
    return {"platform": row[0], "extension_version": row[1], "expires_at": row[2].isoformat()}


def approve(conn: psycopg.Connection, tenant: str, user: str, data: PairingApproval) -> str:
    # Locks serialize confirmations, seat admission and duplicate installation IDs.
    row = conn.execute(
        "select credential_hash,installation_id,platform,extension_version,mode "
        "from extension_pairings where code_hash=%s and expires_at>now() "
        "and approved_tenant_id is null for update",
        (hash_token(data.code),),
    ).fetchone()
    if not row:
        raise LookupError("pairing_unavailable")
    access = conn.execute(
        "select seats from tenant_product_access where tenant_id=%s "
        "and product='secret_guard' and status in ('active','trial','internal') "
        "and (ends_at is null or ends_at>now()) for update",
        (tenant,),
    ).fetchone()
    if not access:
        raise PermissionError("product_access_required")
    existing = conn.execute(
        "select d.tenant_id,g.revoked_at from extension_devices d "
        "join gateway_tokens g on g.id=d.gateway_token_id where d.id=%s for update of d,g",
        (row[1],),
    ).fetchone()
    if existing and (str(existing[0]) != tenant or existing[1] is None):
        raise ValueError("installation_already_registered")
    count = conn.execute(
        "select count(*) from extension_devices d join gateway_tokens g "
        "on g.id=d.gateway_token_id where d.tenant_id=%s and g.revoked_at is null",
        (tenant,),
    ).fetchone()
    if access[0] is not None and count and count[0] >= access[0]:
        raise PermissionError("workstation_limit_reached")
    token = conn.execute(
        "insert into gateway_tokens (tenant_id,name,token_hash,purpose) "
        "values (%s,%s,%s,'extension') returning id",
        (tenant, data.name, row[0]),
    ).fetchone()
    if token is None:  # pragma: no cover
        raise RuntimeError("Missing workstation credential")
    conn.execute(
        "insert into extension_devices "
        "(id,tenant_id,gateway_token_id,platform,extension_version,mode,"
        "member_label,team,enrolled_by) "
        "values (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
        "on conflict (id) do update set gateway_token_id=excluded.gateway_token_id,"
        "platform=excluded.platform,extension_version=excluded.extension_version,"
        "mode=excluded.mode,member_label=excluded.member_label,team=excluded.team,"
        "enrolled_by=excluded.enrolled_by",
        (row[1], tenant, token[0], row[2], row[3], row[4], data.member_label, data.team, user),
    )
    conn.execute(
        "update extension_pairings set approved_tenant_id=%s,gateway_token_id=%s "
        "where code_hash=%s",
        (tenant, token[0], hash_token(data.code)),
    )
    return str(row[1])


def poll(conn: psycopg.Connection, credential: str) -> dict[str, Any]:
    row = conn.execute(
        "select p.installation_id,p.approved_tenant_id,t.name,g.revoked_at "
        "from extension_pairings p left join tenants t on t.id=p.approved_tenant_id "
        "left join gateway_tokens g on g.id=p.gateway_token_id "
        "where p.credential_hash=%s and p.expires_at>now()",
        (hash_token(credential),),
    ).fetchone()
    if not row or row[3] is not None:
        raise LookupError("pairing_unavailable")
    if row[1] is None:
        return {"status": "pending"}
    return {
        "status": "approved",
        "device_id": str(row[0]),
        "organization": {"id": str(row[1]), "name": row[2]},
    }
