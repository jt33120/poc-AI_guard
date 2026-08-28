"""FR-180 — le rapport de promotion, et les deux façons de mentir avec ses chiffres.

C'est l'artefact de conversion du produit : le prospect y lit ce que l'enforcement
*aurait* fait sur ses propres agents. Un chiffre faux ici ne coûte pas un bug, il
coûte la vente et la crédibilité qui va avec — d'où deux tests qui portent moins
sur le calcul que sur ce que le calcul laisse croire.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import audit, monitor, promotion, tenant_tokens
from core.config import Settings
from tests.conftest import DBHandle

_OBSERVED = audit.Origin.llm_proxy(observing=True)
_ENFORCING = audit.Origin.llm_proxy(observing=False)


def _tenant(db: DBHandle) -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tid,))
    db.conn.commit()
    return tid


def _agent(db: DBHandle, tenant: str, name: str = "bot") -> str:
    """A real gateway token: `audit_log.gateway_token_id` carries a foreign key, and
    a report built on invented ids would not be a report about any agent."""
    _, view = tenant_tokens.mint(db.conn, tenant_id=tenant, name=name)
    db.conn.commit()
    return str(view["id"])


def _window(db: DBHandle, tenant: str, token: str, *, hours: int = 2) -> None:
    monitor.open_window(
        db.conn, tenant_id=tenant, gateway_token_id=token, hours=hours, max_hours=8, opened_by="op"
    )
    db.conn.commit()


def _log(
    db: DBHandle,
    tenant: str,
    token: str,
    tool: str,
    decision: str,
    origin: audit.Origin,
    action_class: str | None = "write",
) -> None:
    audit.log_event(
        db.conn,
        tenant_id=tenant,
        decision=decision,
        tool_name=tool,
        action_class=action_class,
        gateway_token_id=token,
        origin=origin,
    )
    db.conn.commit()


def test_no_window_ever_opened_says_so_rather_than_counting_zero(db: DBHandle) -> None:
    report = promotion.build_report(db.conn, tenant_id=_tenant(db))
    assert report.windows == 0
    assert report.has_data is False
    assert "Aucune période d'observation" in report.statement()


def test_a_window_with_nothing_observed_is_not_zero_would_have_been_held(db: DBHandle) -> None:
    """The distinction the ratified spec insists on, and it is not pedantry.

    "0 appels auraient été tenus" reads as "enforcement would have changed
    nothing" — the exact opposite of what an empty observation period means. The
    report must let the console say "aucune donnée" in words.
    """
    tenant = _tenant(db)
    token = _agent(db, tenant)
    _window(db, tenant, token)
    report = promotion.build_report(db.conn, tenant_id=tenant)
    assert report.windows == 1
    assert report.observations == 0
    assert report.has_data is False
    assert "rien à compter" in report.statement()
    assert "zéro appel" in report.statement()  # says the misreading out loud, to refuse it


def test_only_calls_the_gateway_recorded_as_observed_are_counted(db: DBHandle) -> None:
    """Counting by window *date* would sweep in calls made while enforcing.

    Those calls were blocked for real; presenting them as "would have been held"
    inflates the number the whole conversation turns on. The report reads
    `enforcement_mode`, which the adapter derived at the time (`FR-160`).
    """
    tenant = _tenant(db)
    token = _agent(db, tenant)
    _window(db, tenant, token)
    _log(db, tenant, token, "crm.update", "monitor_hold", _OBSERVED)
    _log(db, tenant, token, "crm.update", "monitor_hold", _OBSERVED)
    _log(db, tenant, token, "crm.purge", "monitor_deny", _OBSERVED)
    _log(db, tenant, token, "crm.read", "allow", _OBSERVED, action_class="read")
    # Same window, same tenant, but enforced: it must not enter the count.
    _log(db, tenant, token, "crm.update", "hold", _ENFORCING)

    report = promotion.build_report(db.conn, tenant_id=tenant)
    assert report.held == 2
    assert report.refused == 1
    assert report.observations == 4  # the allowed call is observed too, just not relaxed
    assert {line.tool for line in report.tools} == {"crm.update", "crm.purge", "crm.read"}
    assert report.tools[0].tool == "crm.update"  # sorted by held desc
    assert "2 appel(s) auraient été tenus" in report.statement()


def test_the_caveat_travels_with_the_numbers(db: DBHandle) -> None:
    """`AD-27.2`: observation never relaxed the irreversible or an external send.

    A count read without that reservation says the fleet ran free, and overstates
    what turning enforcement on will change.
    """
    tenant = _tenant(db)
    token = _agent(db, tenant)
    _window(db, tenant, token)
    _log(db, tenant, token, "crm.update", "monitor_hold", _OBSERVED)
    statement = promotion.build_report(db.conn, tenant_id=tenant).statement()
    assert "irreversible" in statement and "external_send" in statement
    assert "bloquées pendant toute la période" in statement


def test_a_running_window_reads_as_provisional_not_as_a_verdict(db: DBHandle) -> None:
    tenant = _tenant(db)
    token = _agent(db, tenant)
    _window(db, tenant, token)
    _log(db, tenant, token, "crm.update", "monitor_hold", _OBSERVED)
    assert promotion.build_report(db.conn, tenant_id=tenant).window_still_open is True
    assert "en cours" in promotion.build_report(db.conn, tenant_id=tenant).statement()


def test_one_agent_is_not_counted_against_another(db: DBHandle) -> None:
    tenant = _tenant(db)
    a, b = _agent(db, tenant, "a"), _agent(db, tenant, "b")
    _window(db, tenant, a)
    _window(db, tenant, b)
    _log(db, tenant, a, "crm.update", "monitor_hold", _OBSERVED)
    _log(db, tenant, b, "crm.purge", "monitor_deny", _OBSERVED)

    assert promotion.build_report(db.conn, tenant_id=tenant, agent=a).held == 1
    assert promotion.build_report(db.conn, tenant_id=tenant, agent=a).refused == 0
    assert promotion.build_report(db.conn, tenant_id=tenant, agent=b).refused == 1
    assert promotion.build_report(db.conn, tenant_id=tenant).held == 1


def test_another_tenant_never_appears_in_the_report(db: DBHandle) -> None:
    mine, theirs = _tenant(db), _tenant(db)
    token = _agent(db, theirs)
    _window(db, theirs, token)
    _log(db, theirs, token, "crm.purge", "monitor_deny", _OBSERVED)
    report = promotion.build_report(db.conn, tenant_id=mine)
    assert report.windows == 0 and report.observations == 0


def test_the_endpoint_serves_operators_and_refuses_viewers(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db)
    token = _agent(db, tenant)
    _window(db, tenant, token)
    _log(db, tenant, token, "crm.update", "monitor_hold", _OBSERVED)

    app = create_app(Settings(_env_file=None, env="dev", database_url=db.url))
    app.state.verifier = test_verifier
    client = TestClient(app)

    viewer = make_token(tenant_id=tenant, role="viewer")
    assert (
        client.get("/v1/promotion", headers={"Authorization": f"Bearer {viewer}"}).status_code
        == 403
    )

    operator = make_token(tenant_id=tenant, role="operator")
    body = client.get("/v1/promotion", headers={"Authorization": f"Bearer {operator}"}).json()
    assert body["held"] == 1 and body["has_data"] is True
    assert body["never_observed"] == ["external_send", "irreversible"]

    bad = client.get(
        "/v1/promotion?agent=not-a-uuid", headers={"Authorization": f"Bearer {operator}"}
    )
    assert bad.status_code == 422
