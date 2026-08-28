#!/usr/bin/env python3
"""Load the committed demonstration tenant (FR-182, FR-183, AD-31).

The fixture is `demo/seed.yaml`: reviewable, committed, and entirely fabricated.
This script only applies it — every value a reviewer would want to check is in the
YAML, not computed here, which is what makes "no third-party personal data"
verifiable by reading a diff.

**Why this writes audit rows with an explicit timestamp, and why that lives here.**

`FR-183` wants accumulated history, so continuous supervision reads as a series
rather than a snapshot. That means writing entries dated in the past, which means
choosing `ts` — a field inside the hashed payload.

This is not a new power. `audit_log.ts` has always been the writer's clock; the
chain attests that a row has not been altered since it was written, never that the
writer was honest about when. What *would* be new is making that choice reachable
from an adapter or an authenticated route. So:

* it lives in `scripts/`, and a test asserts no module under `core/`, `api/` or
  `gateway/` imports it;
* it refuses to run when `ENV=prod`;
* it refuses a tenant that already has audit entries, so it can seed but never
  interleave with real history;
* it builds the payload with `audit.payload_v1` — the same bytes `log_event`
  writes — so `verify_chain` accepts the result rather than being taught to
  tolerate it.

Usage:  DATABASE_URL=... uv run python scripts/seed_demo.py [--force]
"""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import yaml

_REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO))

from core import audit, db, policy_store, tenant_tokens  # noqa: E402
from core.audit import EnforcementMode, Ingress  # noqa: E402
from core.config import get_settings  # noqa: E402
from core.policy import parse_policy  # noqa: E402

_FIXTURE = _REPO / "demo" / "seed.yaml"


class SeedRefused(RuntimeError):
    """The seeder declined to run. The message says which guard fired."""


def load_fixture(path: Path = _FIXTURE) -> dict[str, Any]:
    return dict(yaml.safe_load(path.read_text(encoding="utf-8")))


def _chain_row(
    conn: Any,
    *,
    tenant_id: str,
    at: datetime,
    tool: str,
    action_class: str,
    decision: str,
    gateway_token_id: str,
    ingress: Ingress,
    observing: bool,
) -> None:
    """Append one dated entry, chained exactly as `log_event` would chain it."""
    prev = conn.execute(
        "select entry_hash from audit_log where tenant_id = %s order by id desc limit 1",
        (tenant_id,),
    ).fetchone()
    prev_hash = prev[0] if prev else audit.GENESIS
    request_id = uuid4().hex
    payload = audit.payload_v1(
        ts_iso=at.astimezone(UTC).isoformat(),
        tenant_id=tenant_id,
        user_id=None,
        request_id=request_id,
        tool_name=tool,
        action_class=action_class,
        decision=decision,
        policy_rule_id=tool,
        judge_used=False,
        args_hash=None,
        latency_ms=None,
        error=None,
    )
    conn.execute(
        "insert into audit_log "
        "(ts, tenant_id, request_id, tool_name, action_class, decision, policy_rule_id, "
        " judge_used, gateway_token_id, ingress, enforcement_mode, prev_hash, entry_hash) "
        "values (%s, %s, %s, %s, %s, %s, %s, false, %s, %s, %s, %s, %s)",
        (
            at,
            tenant_id,
            request_id,
            tool,
            action_class,
            decision,
            tool,
            gateway_token_id,
            ingress.value,
            (EnforcementMode.observing if observing else EnforcementMode.enforcing).value,
            prev_hash,
            audit.compute_entry_hash(prev_hash, payload),
        ),
    )


def seed(database_url: str, *, env: str, force: bool = False) -> dict[str, Any]:
    """Apply the fixture. Returns what was written, for the caller to print."""
    if env == "prod" and not force:
        raise SeedRefused(
            "ENV=prod : le tenant de démonstration ne se charge pas en production. "
            "Un historique fabriqué à côté d'un historique réel n'est plus un journal."
        )
    fixture = load_fixture()
    now = datetime.now(UTC)
    written: dict[str, Any] = {"events": 0, "windows": 0}

    with db.connection(database_url) as conn:
        tenant_id = str(uuid4())
        conn.execute(
            "insert into tenants (id, name) values (%s, %s)", (tenant_id, fixture["tenant"]["name"])
        )
        existing = conn.execute(
            "select count(*) from audit_log where tenant_id = %s", (tenant_id,)
        ).fetchone()
        if existing and existing[0]:  # pragma: no cover - a fresh uuid has no history
            raise SeedRefused(f"le tenant {tenant_id} porte déjà des entrées d'audit")

        tokens = {}
        for agent in fixture["agents"]:
            _, view = tenant_tokens.mint(conn, tenant_id=tenant_id, name=agent["name"])
            tokens[agent["key"]] = str(view["id"])

        # Parsed on the way in: a demo whose policy does not load is a demo that
        # fails in front of the prospect rather than in CI.
        parse_policy(fixture["policy"])
        policy_store.save_yaml(conn, tenant_id, fixture["policy"])

        for entry in fixture["historique"]:
            at = now - timedelta(days=float(entry["il_y_a_jours"]))
            for index in range(int(entry["n"])):
                _chain_row(
                    conn,
                    tenant_id=tenant_id,
                    # Spread within the day so a timeline reads as activity, not a spike.
                    at=at + timedelta(minutes=17 * index),
                    tool=entry["outil"],
                    action_class=entry["classe"],
                    decision=entry["decision"],
                    gateway_token_id=tokens[entry["agent"]],
                    ingress=Ingress.mcp_gateway,
                    observing=False,
                )
                written["events"] += 1

        window = fixture.get("fenetre_observation")
        if window:
            opened = now - timedelta(days=float(window["ouverte_il_y_a_jours"]))
            expires = opened + timedelta(hours=float(window["duree_heures"]))
            conn.execute(
                "insert into monitor_windows "
                "(tenant_id, gateway_token_id, opened_at, expires_at, closed_at, opened_by) "
                "values (%s, %s, %s, %s, %s, %s)",
                (
                    tenant_id,
                    tokens[window["agent"]],
                    opened,
                    expires,
                    expires,
                    window["ouverte_par"],
                ),
            )
            written["windows"] = 1
            for entry in window["observations"]:
                for index in range(int(entry["n"])):
                    _chain_row(
                        conn,
                        tenant_id=tenant_id,
                        at=opened + timedelta(minutes=11 * index),
                        tool=entry["outil"],
                        action_class=entry["classe"],
                        decision=entry["decision"],
                        gateway_token_id=tokens[window["agent"]],
                        # Observation exists on the LLM proxy path and nowhere else
                        # (`FR-179`). Seeding observed calls on the MCP gateway would
                        # depict a state the product cannot produce — a demo that
                        # shows something the code does not do is the defect this
                        # whole strata argues against.
                        ingress=Ingress.llm_proxy,
                        observing=True,
                    )
                    written["events"] += 1
        conn.commit()

        # The seed is only worth loading if it verifies like real history.
        result = audit.verify_chain(conn, tenant_id)
        if not result.ok:  # pragma: no cover - a broken seed is a bug in `_chain_row`
            raise SeedRefused(f"la chaîne semée ne vérifie pas (rompue à id={result.broken_id})")

    written["tenant_id"] = tenant_id
    written["agents"] = tokens
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description="Charge le tenant de démonstration.")
    parser.add_argument(
        "--force", action="store_true", help="charger même si ENV=prod (à vos risques)"
    )
    args = parser.parse_args()
    settings = get_settings()
    if not settings.database_url:
        print("seed_demo: DATABASE_URL n'est pas configurée", file=sys.stderr)
        return 2
    try:
        written = seed(settings.database_url, env=settings.env, force=args.force)
    except SeedRefused as exc:
        print(f"seed_demo: {exc}", file=sys.stderr)
        return 1
    print(
        f"seed_demo: tenant {written['tenant_id']} — {written['events']} entrées d'audit, "
        f"{written['windows']} fenêtre(s) d'observation, chaîne vérifiée"
    )
    for key, token_id in written["agents"].items():
        print(f"  agent {key}: {token_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
