"""Routes de déclaration de provenance : RBAC, validation, isolation par tenant."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core.config import Settings
from tests.conftest import DBHandle

_REVUE = (datetime.now(UTC) - timedelta(days=7)).isoformat()


def _client(url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=url))
    app.state.verifier = verifier
    return TestClient(app)


def _tenant(db: DBHandle, name: str = "A") -> str:
    tid = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, %s)", (tid, name))
    db.conn.commit()
    return str(tid)


def _payload(**kw: object) -> dict[str, object]:
    return {
        "name": "base-clients",
        "kind": "vector_store",
        "source": "export CRM interne",
        "steward": "Direction des données",
        "last_reviewed_at": _REVUE,
        **kw,
    }


def test_an_admin_declares_and_the_tenant_reads_it_back(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='admin')}"}

    created = client.put("/v1/corpora", headers=admin, json=_payload())
    assert created.status_code == 200
    assert created.json()["stale"] is False

    listed = client.get("/v1/corpora", headers=admin).json()
    assert [c["name"] for c in listed] == ["base-clients"]
    assert listed[0]["review_age_days"] >= 6


def test_a_viewer_may_read_but_not_declare(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Déclarer engage le tenant devant un auditeur : c'est une action d'admin.

    Lire ne l'engage pas. La séparation vit dans l'exigence de rôle de la route, pas
    dans une convention que la prochaine route pourrait oublier.
    """
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    viewer = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='viewer')}"}

    assert client.put("/v1/corpora", headers=viewer, json=_payload()).status_code == 403
    assert client.get("/v1/corpora", headers=viewer).status_code == 200


def test_a_review_dated_in_the_future_is_refused_at_the_edge(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='admin')}"}

    futur = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    refuse = client.put("/v1/corpora", headers=admin, json=_payload(last_reviewed_at=futur))
    assert refuse.status_code == 400
    assert "futur" in refuse.json()["detail"]


def test_an_unknown_field_is_refused(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """`extra="forbid"` : un champ inconnu est une faute de frappe ou une hypothèse.

    Les deux valent mieux refusées que silencieusement ignorées — c'est la même règle
    que le vocabulaire fermé des contraintes de policy.
    """
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='admin')}"}
    assert client.put("/v1/corpora", headers=admin, json=_payload(owner="x")).status_code == 422


def test_one_tenants_declarations_are_invisible_to_another(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """L'isolation vient de RLS, pas d'un `where` que la requête a pensé à écrire.

    `core/corpora.py` `list_corpora` ne filtre sur aucun tenant : c'est Postgres qui
    refuse. Si la policy ou son `grant` disparaissait, ce test tomberait — ce qui est
    exactement ce qu'on lui demande (`G-32`).
    """
    a = _tenant(db, "A")
    b = _tenant(db, "B")
    client = _client(db.url, test_verifier)
    admin_a = {"Authorization": f"Bearer {make_token(tenant_id=a, role='admin')}"}
    admin_b = {"Authorization": f"Bearer {make_token(tenant_id=b, role='admin')}"}

    assert client.put("/v1/corpora", headers=admin_a, json=_payload(name="chez-a")).status_code
    assert client.put("/v1/corpora", headers=admin_b, json=_payload(name="chez-b")).status_code

    vus_par_a = [c["name"] for c in client.get("/v1/corpora", headers=admin_a).json()]
    vus_par_b = [c["name"] for c in client.get("/v1/corpora", headers=admin_b).json()]

    assert vus_par_a == ["chez-a"]
    assert vus_par_b == ["chez-b"]


def test_the_same_name_may_be_declared_by_two_tenants(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """L'unicité porte sur (tenant, nom), pas sur le nom.

    Deux clients appelant leur index « base-clients » est le cas nominal ; une
    contrainte globale ferait échouer le second à cause du premier.
    """
    a = _tenant(db, "A")
    b = _tenant(db, "B")
    client = _client(db.url, test_verifier)
    for tid in (a, b):
        admin = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='admin')}"}
        assert client.put("/v1/corpora", headers=admin, json=_payload()).status_code == 200
