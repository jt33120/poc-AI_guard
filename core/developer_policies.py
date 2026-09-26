"""Signed, tenant-scoped Developer Guard policies.

The database stores policy bodies and signatures, never a private key. A runner
accepts a document only after matching the pinned public key and Ed25519 signature.
"""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core.checkpoints import Ed25519Signer
from core.config import Settings

if TYPE_CHECKING:  # pragma: no cover
    import psycopg


class DeveloperPolicyError(ValueError):
    """A policy cannot be published or used."""


class PolicyVersionConflict(DeveloperPolicyError):
    """A caller attempted to overwrite an equal or newer policy."""


AssistantName = Literal["claude", "codex", "copilot", "unknown"]
PolicyEvent = Literal["prompt", "read", "write", "delete", "command", "network", "mcp", "unknown"]
ActionClass = Literal[
    "read", "write", "delete", "publish", "deploy", "network", "security", "mcp", "unknown"
]
PolicyEffect = Literal["allow", "deny", "require_approval"]
ResourcePrefix = Annotated[str, Field(min_length=1, max_length=1024)]
ToolName = Annotated[str, Field(min_length=1, max_length=256)]


class DeveloperPolicyMatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assistants: list[AssistantName] | None = Field(default=None, max_length=4)
    events: list[PolicyEvent] | None = Field(default=None, max_length=8)
    action_classes: list[ActionClass] | None = Field(
        alias="actionClasses", default=None, max_length=9
    )
    resource_prefixes: list[ResourcePrefix] | None = Field(
        alias="resourcePrefixes", default=None, max_length=100
    )
    tools: list[ToolName] | None = Field(default=None, max_length=100)


class DeveloperPolicyRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=128, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    effect: Literal["allow", "deny", "require_approval"]
    reason: str | None = Field(default=None, max_length=240)
    match: DeveloperPolicyMatch


class DeveloperPolicyDefaults(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unknown_action: PolicyEffect = Field(alias="unknownAction")


class DeveloperPolicyBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = Field(alias="schemaVersion", default=1)
    policy_id: str = Field(alias="policyId", min_length=1, max_length=128)
    version: int = Field(ge=1)
    issued_at: datetime = Field(alias="issuedAt")
    expires_at: datetime = Field(alias="expiresAt")
    min_runner_version: str | None = Field(alias="minRunnerVersion", default=None, max_length=64)
    defaults: DeveloperPolicyDefaults
    rules: list[DeveloperPolicyRule] = Field(max_length=500)

    @field_validator("schema_version")
    @classmethod
    def _version_one(cls, value: int) -> int:
        if value != 1:
            raise ValueError("unsupported policy schema")
        return value

    @field_validator("rules")
    @classmethod
    def _unique_rule_ids(cls, value: list[DeveloperPolicyRule]) -> list[DeveloperPolicyRule]:
        if len({rule.id for rule in value}) != len(value):
            raise ValueError("policy rule ids must be unique")
        return value

    @model_validator(mode="after")
    def _valid_dates(self) -> DeveloperPolicyBody:
        if self.issued_at.tzinfo is None or self.expires_at.tzinfo is None:
            raise ValueError("policy timestamps must include a timezone")
        if self.expires_at <= self.issued_at:
            raise ValueError("policy expiry must be after issuance")
        return self

    def canonical_payload(self, tenant_id: str) -> dict[str, Any]:
        payload = self.model_dump(by_alias=True, mode="json")
        payload["tenantId"] = tenant_id
        return payload


class DeveloperActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assistant: AssistantName
    event: PolicyEvent
    action_class: ActionClass = Field(alias="actionClass")
    resource: str | None = Field(default=None, max_length=4096)
    tool: str | None = Field(default=None, max_length=256)
    capability_verified: bool = Field(alias="capabilityVerified")


def evaluate(
    policy: DeveloperPolicyBody | None,
    request: DeveloperActionRequest,
    now: datetime | None = None,
) -> PolicyEffect:
    """Mirror the deterministic TypeScript evaluator for shared contract vectors."""
    if not request.capability_verified and request.action_class != "read":
        return "deny"
    if policy is None:
        return "allow" if request.action_class == "read" else "deny"
    clock = now or datetime.now(UTC)
    if policy.issued_at > clock or policy.expires_at <= clock:
        return "deny"
    effects: list[PolicyEffect] = []
    for rule in policy.rules:
        match = rule.match
        if match.assistants is not None and request.assistant not in match.assistants:
            continue
        if match.events is not None and request.event not in match.events:
            continue
        if match.action_classes is not None and request.action_class not in match.action_classes:
            continue
        if match.resource_prefixes is not None and not (
            request.resource is not None
            and any(request.resource.startswith(prefix) for prefix in match.resource_prefixes)
        ):
            continue
        if match.tools is not None and request.tool not in match.tools:
            continue
        effects.append(rule.effect)
    if not effects:
        return policy.defaults.unknown_action
    if "deny" in effects:
        return "deny"
    if "require_approval" in effects:
        return "require_approval"
    return "allow"


def _canonical(payload: dict[str, Any]) -> bytes:
    """Octets signés : l'équivalent exact de ``canonicalizePolicyPayload`` du runner.

    Le poste reconstruit la forme canonique avec ``JSON.stringify``, qui écrit les
    caractères non ASCII tels quels. ``ensure_ascii`` (le défaut de ``json.dumps``) les
    échappait en ``\\uXXXX`` : une seule lettre accentuée dans un ``reason`` suffisait
    pour que tous les postes refusent la signature. Une politique ASCII garde les mêmes
    octets, donc les enveloppes déjà publiées restent valides
    (``tests/test_developer_policy_canonical.py``).
    """
    return json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def signer(settings: Settings) -> Ed25519Signer:
    raw = settings.developer_policy_signing_key
    if not raw:
        raise DeveloperPolicyError("developer policy signer is not configured")
    try:
        seed = base64.b64decode(raw, validate=True)
    except (ValueError, TypeError) as exc:
        raise DeveloperPolicyError("DEVELOPER_POLICY_SIGNING_KEY must be valid base64") from exc
    try:
        return Ed25519Signer(seed)
    except ValueError as exc:
        raise DeveloperPolicyError("DEVELOPER_POLICY_SIGNING_KEY must decode to 32 bytes") from exc


def sign(body: DeveloperPolicyBody, tenant_id: str, signing: Ed25519Signer) -> dict[str, Any]:
    payload = body.canonical_payload(tenant_id)
    signature = base64.b64encode(signing.sign(_canonical(payload))).decode("ascii")
    return {
        "policy": payload,
        "keyId": signing.key_id,
        "publicKey": signing.public_key,
        "signature": signature,
    }


def publish(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    body: DeveloperPolicyBody,
    signing: Ed25519Signer,
    published_by: str,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    if body.issued_at > now or body.expires_at <= now:
        raise DeveloperPolicyError("policy validity window is invalid")
    envelope = sign(body, tenant_id, signing)
    result = conn.execute(
        "insert into developer_policies "
        "(tenant_id,policy_id,version,policy,expires_at,key_id,public_key,signature,published_by) "
        "values (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
        "on conflict (tenant_id,policy_id) do update set "
        "version=excluded.version,policy=excluded.policy,expires_at=excluded.expires_at,"
        "key_id=excluded.key_id,public_key=excluded.public_key,signature=excluded.signature,"
        "published_by=excluded.published_by,published_at=now(),revoked_at=null "
        "where developer_policies.version < excluded.version",
        (
            tenant_id,
            body.policy_id,
            body.version,
            json.dumps(envelope["policy"]),
            body.expires_at,
            envelope["keyId"],
            envelope["publicKey"],
            envelope["signature"],
            published_by,
        ),
    )
    if result.rowcount != 1:
        raise PolicyVersionConflict("policy version must increase")
    return envelope


def current_for_device(
    conn: psycopg.Connection,
    tenant_id: str,
    device_id: str,
) -> dict[str, Any] | None:
    row = conn.execute(
        "select p.policy,p.key_id,p.public_key,p.signature from developer_policy_assignments a "
        "join developer_policies p on p.tenant_id=a.tenant_id and p.policy_id=a.policy_id "
        "where a.tenant_id=%s and a.device_id=%s and p.revoked_at is null and p.expires_at > now()",
        (tenant_id, device_id),
    ).fetchone()
    if row is None:
        return None
    return {"policy": row[0], "keyId": row[1], "publicKey": row[2], "signature": row[3]}


def assign(conn: psycopg.Connection, *, tenant_id: str, device_id: str, policy_id: str) -> None:
    exists = conn.execute(
        "select 1 from developer_policies "
        "where tenant_id=%s and policy_id=%s and revoked_at is null",
        (tenant_id, policy_id),
    ).fetchone()
    if exists is None:
        raise LookupError("policy_not_found")
    device = conn.execute(
        "select 1 from extension_devices where tenant_id=%s and id=%s",
        (tenant_id, device_id),
    ).fetchone()
    if device is None:
        raise LookupError("device_not_found")
    conn.execute(
        "insert into developer_policy_assignments (tenant_id,device_id,policy_id) "
        "values (%s,%s,%s) on conflict (tenant_id,device_id) do update set "
        "policy_id=excluded.policy_id,assigned_at=now()",
        (tenant_id, device_id, policy_id),
    )


def list_for_tenant(conn: psycopg.Connection, tenant_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "select policy_id,version,expires_at,published_at,revoked_at,key_id "
        "from developer_policies "
        "where tenant_id=%s order by published_at desc",
        (tenant_id,),
    ).fetchall()
    return [
        {
            "policy_id": row[0],
            "version": row[1],
            "expires_at": row[2],
            "published_at": row[3],
            "revoked_at": row[4],
            "key_id": row[5],
        }
        for row in rows
    ]


def revoke(conn: psycopg.Connection, tenant_id: str, policy_id: str) -> bool:
    row = conn.execute(
        "update developer_policies set revoked_at=now() "
        "where tenant_id=%s and policy_id=%s and revoked_at is null returning policy_id",
        (tenant_id, policy_id),
    ).fetchone()
    return row is not None
