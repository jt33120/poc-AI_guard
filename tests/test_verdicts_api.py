"""Route d'ingestion des verdicts tiers : RBAC, validation, rejeu (`FR-191`)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import verdicts
from core.config import Settings
from tests.conftest import DBHandle

_RAN = (datetime.now(UTC) - timedelta(hours=1)).isoformat()


def _client(url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=url))
    app.state.verifier = verifier
    return TestClient(app)


def _tenant(db: DBHandle) -> str:
    tid = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tid,))
    db.conn.commit()
    return str(tid)


def _payload(**kw: object) -> dict[str, object]:
    return {
        "analyzer": "semgrep",
        "analyzer_version": "1.86.0",
        "ruleset": "p/ci",
        "repository": "acme/api",
        "commit_sha": "9f1c2ab",
        "verdict": "fail",
        "findings": {"high": 1},
        "ran_at": _RAN,
        **kw,
    }


def test_an_admin_ingests_a_receipt_and_gets_its_chain_entry(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='admin')}"}

    created = client.post("/v1/verdicts", headers=admin, json=_payload())
    assert created.status_code == 201
    body = created.json()
    assert len(body["entry_hash"]) == 64 and len(body["receipt_digest"]) == 64
    assert verdicts.verify_chain(db.conn, tid).ok is True


def test_a_viewer_may_not_ingest(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Un reçu part dans l'Evidence Pack remis à un auditeur : il engage le tenant.

    C'est donc une action d'`admin`, comme déclarer la provenance d'un corpus — et
    pour la même raison. Un opérateur qui pousserait un `pass` inventé fabriquerait
    une preuve, ce que toute la chaîne existe pour rendre impossible.
    """
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    viewer = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='viewer')}"}

    assert client.post("/v1/verdicts", headers=viewer, json=_payload()).status_code == 403


def test_an_anonymous_caller_may_not_ingest(db: DBHandle, test_verifier: TokenVerifier) -> None:
    """La route n'est pas publique : elle écrit dans une table append-only."""
    client = _client(db.url, test_verifier)
    assert client.post("/v1/verdicts", json=_payload()).status_code == 401


def test_an_unknown_verdict_value_is_refused_at_the_edge(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Le vocabulaire du verdict est clos.

    Un analyseur qui renverrait `warn` doit être traduit par la CI du client, pas
    stocké tel quel : sur une table append-only, un troisième mot arriverait sans
    qu'aucun lecteur sache quoi en faire, et il ne pourrait plus être retiré.
    """
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='admin')}"}

    refuse = client.post("/v1/verdicts", headers=admin, json=_payload(verdict="warn"))
    assert refuse.status_code == 422


def test_the_same_receipt_twice_is_a_conflict(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='admin')}"}

    assert client.post("/v1/verdicts", headers=admin, json=_payload()).status_code == 201
    again = client.post("/v1/verdicts", headers=admin, json=_payload())
    assert again.status_code == 409


def test_a_receipt_lands_in_its_own_tenant_only(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Le tenant vient du jeton, jamais du corps : il n'y a pas de champ pour le dire.

    L'assertion vaut d'être écrite parce que la table est append-only — une ligne
    posée dans le mauvais tenant ne se déplace pas, elle reste.
    """
    a, b = _tenant(db), _tenant(db)
    client = _client(db.url, test_verifier)
    admin_a = {"Authorization": f"Bearer {make_token(tenant_id=a, role='admin')}"}

    assert client.post("/v1/verdicts", headers=admin_a, json=_payload()).status_code == 201
    assert verdicts.verify_chain(db.conn, a).count == 1
    assert verdicts.verify_chain(db.conn, b).count == 0
