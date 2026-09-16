"""Device-bound, content-free extension evidence. Client claims stay client claims."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from core import audit


class Registration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    installation_id: UUID
    platform: Literal["win32", "darwin", "linux"]
    extension_version: str = Field(pattern=r"^\d{1,3}\.\d{1,3}\.\d{1,3}$")
    mode: Literal["block", "redact", "observe"]


class Event(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: UUID
    at: AwareDatetime
    kind: Literal["scan", "mode_changed", "local_test", "gateway_configured", "heartbeat"]
    assistant: Literal["manual", "secretguard", "claude", "codex", "copilot", "windsurf"]
    mode: Literal["block", "redact", "observe"]
    outcome: Literal["clean", "blocked", "redacted", "warned", "passed", "failed", "configured"]
    findings: int = Field(default=0, ge=0, le=10000)
    dropped: int = Field(default=0, ge=0, le=1000000000)


class Batch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    events: list[Event] = Field(max_length=100, min_length=1)


def register(conn: psycopg.Connection, tenant: str, token: str, data: Registration) -> str:
    """A token cannot silently become a second workstation, nor change tenants."""
    with conn.transaction():
        conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"device:{token}",))
        current = conn.execute(
            "select id from extension_devices where gateway_token_id = %s", (token,)
        ).fetchone()
        if current and str(current[0]) != str(data.installation_id):
            raise ValueError("token_already_bound")
        conn.execute(
            "insert into extension_devices "
            "(id,tenant_id,gateway_token_id,platform,extension_version,mode) "
            "values (%s,%s,%s,%s,%s,%s) on conflict (gateway_token_id) do update set "
            "extension_version=excluded.extension_version, mode=excluded.mode,last_seen_at=now()",
            (data.installation_id, tenant, token, data.platform, data.extension_version, data.mode),
        )
    conn.commit()
    return str(data.installation_id)


def device_for(conn: psycopg.Connection, tenant: str, token: str) -> str:
    row = conn.execute(
        "select id from extension_devices where tenant_id = %s and gateway_token_id = %s",
        (tenant, token),
    ).fetchone()
    if row is None:
        raise LookupError("device_not_registered")
    return str(row[0])


def event_hash(tenant: str, device: str, event: str, source: str, payload: Any, prev: str) -> str:
    canonical = json.dumps(
        {"tenant": tenant, "device": device, "event": event, "source": source, "payload": payload},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    return hashlib.sha256((prev + canonical).encode()).hexdigest()


def record(
    conn: psycopg.Connection,
    tenant: str,
    device: str,
    event_id: str,
    source: Literal["extension", "gateway"],
    payload: dict[str, Any],
) -> None:
    with conn.transaction():
        conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"extension:{tenant}",))
        duplicate = conn.execute(
            "select source,payload from extension_events where device_id=%s and event_id=%s",
            (device, event_id),
        ).fetchone()
        if duplicate:
            if duplicate[0] != source or duplicate[1] != payload:
                raise ValueError("event_id_conflict")
            return
        previous = conn.execute(
            "select entry_hash from extension_events where tenant_id=%s order by id desc limit 1",
            (tenant,),
        ).fetchone()
        prev = previous[0] if previous else audit.GENESIS
        received = datetime.now(UTC)
        signed = {"received_at": audit.canonical_ts(received), "data": payload}
        digest = event_hash(tenant, device, event_id, source, signed, prev)
        conn.execute(
            "insert into extension_events "
            "(tenant_id,device_id,event_id,source,payload,prev_hash,entry_hash,received_at) "
            "values (%s,%s,%s,%s,%s::jsonb,%s,%s,%s)",
            (tenant, device, event_id, source, json.dumps(payload), prev, digest, received),
        )
        conn.execute("update extension_devices set last_seen_at=now() where id=%s", (device,))


def verify(conn: psycopg.Connection, tenant: str) -> bool:
    previous = audit.GENESIS
    for device, event, source, payload, prev, digest, received in conn.execute(
        "select device_id,event_id,source,payload,prev_hash,entry_hash,received_at "
        "from extension_events "
        "where tenant_id=%s order by id",
        (tenant,),
    ):
        signed = {"received_at": audit.canonical_ts(received), "data": payload}
        if prev != previous or digest != event_hash(
            tenant, str(device), str(event), source, signed, prev
        ):
            return False
        previous = digest
    return True
