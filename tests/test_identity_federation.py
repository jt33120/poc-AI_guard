"""`FR-196` — fédérer l'identité de la console sans perdre la trace des rôles.

`EXH-8` : un RSSI n'approuve pas un outil qui détient l'autorité d'approbation sur des
actions de production **et** gère son propre annuaire par invitations e-mail. La
fédération est donc une porte d'entrée, pas un confort — mais elle déplace la décision
« qui peut approuver » chez le client, et c'est pour cela que ce qu'on en *déduit* doit
rester traçable ici.

Ces tests tiennent les deux moitiés : le rôle se déduit bien des groupes, et
l'attribution laisse une ligne chaînée. Les deux contrôles de non-vacuité comptent
autant : un jeton GoTrue existant ne change pas de comportement, et une présentation
répétée du même jeton n'écrit rien.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier, build_federation
from core import control_plane, role_map
from core.config import Settings
from core.schemas import Role
from tests.conftest import DBHandle

_SUB = "8f14e45f-ea6b-4b7a-9d3e-1c2b3a4d5e6f"


# ---------------------------------------------------------------------------
# La correspondance, pure
# ---------------------------------------------------------------------------
def test_a_group_maps_to_its_declared_role() -> None:
    mapping = role_map.parse_group_roles("platform-admins:admin,sec-ops:operator")
    assert role_map.role_for_groups(["sec-ops"], mapping) is Role.operator


def test_an_unmapped_group_yields_no_role() -> None:
    """Fail-closed : l'appelant tombera en 403, pas en `viewer` par défaut.

    Attribuer un rôle par défaut à un groupe que personne n'a désigné ouvrirait la
    console à toute la population de l'IdP du client.
    """
    mapping = role_map.parse_group_roles("platform-admins:admin")
    assert role_map.role_for_groups(["stagiaires"], mapping) is None


def test_several_recognised_groups_yield_the_least_privileged() -> None:
    """Appartenir à un groupe de plus ne doit jamais élever.

    Sinon l'ajout d'un groupe anodin dans l'IdP du client devient une escalade de
    privilège que personne ne relit.
    """
    mapping = role_map.parse_group_roles("a:admin,b:viewer")
    assert role_map.role_for_groups(["a", "b"], mapping) is Role.viewer


def test_an_unknown_role_stops_the_boot() -> None:
    """Le vocabulaire de rôles est fermé : « admin-ish » ne se déclare pas."""
    with pytest.raises(role_map.RoleMapError, match="rôle inconnu"):
        role_map.parse_group_roles("platform-admins:superuser")


def test_a_malformed_pair_stops_the_boot() -> None:
    with pytest.raises(role_map.RoleMapError, match="malformée"):
        role_map.parse_group_roles("platform-admins")


@pytest.mark.parametrize(
    "claims, attendu",
    [
        ({"groups": ["a", "b"]}, ["a", "b"]),
        ({"groups": "a"}, ["a"]),  # certains IdP rendent une chaîne unique
        ({"groups": None}, []),
        ({}, []),
        ({"groups": [1, "a"]}, ["a"]),  # rien d'autre qu'une chaîne n'est un groupe
    ],
)
def test_group_claims_come_in_several_shapes(claims: dict[str, Any], attendu: list[str]) -> None:
    assert role_map.groups_in(claims, "groups") == attendu


def test_a_claim_path_that_leads_nowhere_is_none_not_an_error() -> None:
    """Un jeton mal formé est un refus d'authentification, pas un 500 (§4.8)."""
    assert role_map.claim_at({"a": "pas un objet"}, "a.b.c") is None
    assert role_map.claim_at({}, "a.b.c.d.e") is None  # plus profond que la borne


# ---------------------------------------------------------------------------
# La chaîne d'événements
# ---------------------------------------------------------------------------
def _tenant(db: DBHandle) -> str:
    tid = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'F')", (tid,))
    db.conn.commit()
    return str(tid)


def test_an_assignment_is_chained_and_verifiable(db: DBHandle) -> None:
    tid = _tenant(db)
    first = control_plane.record_assignment(
        db.conn, tenant_id=tid, subject=_SUB, role=Role.operator, groups=["sec-ops"]
    )
    assert first is not None
    assert control_plane.verify_chain(db.conn, tid).ok is True


def test_the_same_token_presented_again_writes_nothing(db: DBHandle) -> None:
    """Le contrôle qui empêche le journal de devenir un compteur de requêtes.

    Un jeton fédéré est présenté à chaque appel. Sans cette règle, une console
    active graverait des milliers de lignes disant que rien n'a changé.
    """
    tid = _tenant(db)
    control_plane.record_assignment(
        db.conn, tenant_id=tid, subject=_SUB, role=Role.operator, groups=["sec-ops"]
    )
    rejoue = control_plane.record_assignment(
        db.conn, tenant_id=tid, subject=_SUB, role=Role.operator, groups=["sec-ops"]
    )
    assert rejoue is None
    n = db.conn.execute("select count(*) from control_plane_events").fetchone()
    assert n is not None and n[0] == 1


def test_a_changed_role_is_written(db: DBHandle) -> None:
    """La moitié passante : une règle qui n'écrit jamais ne trace rien."""
    tid = _tenant(db)
    control_plane.record_assignment(
        db.conn, tenant_id=tid, subject=_SUB, role=Role.viewer, groups=["lecteurs"]
    )
    promu = control_plane.record_assignment(
        db.conn, tenant_id=tid, subject=_SUB, role=Role.admin, groups=["platform-admins"]
    )
    assert promu is not None
    assert control_plane.verify_chain(db.conn, tid).count == 2


def test_group_order_is_not_a_change(db: DBHandle) -> None:
    """L'ordre dans lequel un IdP rend ses groupes n'est pas stable."""
    tid = _tenant(db)
    control_plane.record_assignment(
        db.conn, tenant_id=tid, subject=_SUB, role=Role.admin, groups=["a", "b"]
    )
    assert (
        control_plane.record_assignment(
            db.conn, tenant_id=tid, subject=_SUB, role=Role.admin, groups=["b", "a", "b"]
        )
        is None
    )


def test_no_group_name_is_ever_stored(db: DBHandle) -> None:
    """Les noms de groupes disent l'organigramme du client (`CLAUDE.md` §4.10)."""
    tid = _tenant(db)
    control_plane.record_assignment(
        db.conn, tenant_id=tid, subject=_SUB, role=Role.admin, groups=["direction-fusions-acquisitions"]
    )
    lignes = db.conn.execute("select * from control_plane_events").fetchall()
    assert "direction-fusions-acquisitions" not in str(lignes)


def test_the_log_is_append_only(db: DBHandle) -> None:
    """Append-only par trigger, donc fermé y compris pour le backend (§4.2)."""
    import psycopg

    tid = _tenant(db)
    control_plane.record_assignment(
        db.conn, tenant_id=tid, subject=_SUB, role=Role.admin, groups=["a"]
    )
    db.conn.commit()
    for sql in ("update control_plane_events set role = 'viewer'", "delete from control_plane_events"):
        with pytest.raises(psycopg.errors.RaiseException):
            db.conn.execute(sql)
        db.conn.rollback()


def test_a_broken_chain_is_seen(db: DBHandle) -> None:
    """Une chaîne qu'aucun vérificateur ne parcourt n'est pas une chaîne."""
    tid = _tenant(db)
    control_plane.record_assignment(
        db.conn, tenant_id=tid, subject=_SUB, role=Role.admin, groups=["a"]
    )
    db.conn.commit()
    # Le trigger interdit l'UPDATE : on simule l'altération en insérant une ligne dont
    # le `prev_hash` ne suit pas la précédente.
    db.conn.execute(
        "insert into control_plane_events "
        " (tenant_id, event, subject, role, groups_hash, entry_digest, prev_hash, entry_hash) "
        "values (%s, %s, %s, 'viewer', 'x', 'y', 'PAS_LE_BON', 'z')",
        (tid, control_plane.ROLE_ASSIGNED, _SUB),
    )
    db.conn.commit()
    assert control_plane.verify_chain(db.conn, tid).ok is False


# ---------------------------------------------------------------------------
# De bout en bout, par la vraie dépendance d'authentification
# ---------------------------------------------------------------------------
def _federated_app(db: DBHandle, verifier: TokenVerifier) -> TestClient:
    settings = Settings(
        _env_file=None,
        env="dev",
        database_url=db.url,
        issuer_claims="oidc_groups",
        issuer_group_roles="platform-admins:admin,lecteurs:viewer",
        issuer_tenant_claim="app_metadata.tenant_id",
    )
    app = create_app(settings)
    app.state.verifier = verifier
    return TestClient(app)


def _inventaire() -> dict[str, Any]:
    """Une charge valide pour `PUT /v1/shadow-ai`, route réservée à l'`admin`.

    Le choix de la route est délibéré : elle exige un rôle. Une route seulement
    authentifiée aurait rendu 200 sur un jeton sans rôle, et le test aurait prouvé
    que la signature est valide — pas que le rôle a été résolu.
    """
    fin = datetime.now(UTC)
    return {
        "window_start": (fin - timedelta(days=30)).isoformat(),
        "window_end": fin.isoformat(),
        "supervised": {},
        "shadow": {"ChatGPT": 1},
        "unclassified": 0,
        "rejected": 0,
    }


def test_a_federated_admin_is_admitted_and_the_assignment_is_chained(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Les deux moitiés de `FR-196`, sur le vrai chemin d'authentification."""
    tid = _tenant(db)
    client = _federated_app(db, test_verifier)
    jeton = make_token(tenant_id=tid, role=None, groups=["platform-admins"], sub=_SUB)

    ecrit = client.put(
        "/v1/shadow-ai", headers={"Authorization": f"Bearer {jeton}"}, json=_inventaire()
    )
    assert ecrit.status_code == 200, "un admin fédéré doit franchir une route réservée"

    ligne = db.conn.execute(
        "select role, subject from control_plane_events where tenant_id = %s", (tid,)
    ).fetchone()
    assert ligne is not None, "l'attribution n'a laissé aucune trace"
    assert ligne[0] == "admin" and ligne[1] == _SUB


def test_a_federated_token_without_a_known_group_is_refused(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Fail-closed de bout en bout : aucun groupe reconnu, aucun rôle, 403.

    Et rien n'est consigné : sans rôle, il n'y a pas d'attribution à tracer.
    """
    tid = _tenant(db)
    client = _federated_app(db, test_verifier)
    jeton = make_token(tenant_id=tid, role=None, groups=["stagiaires"], sub=_SUB)

    refuse = client.put(
        "/v1/shadow-ai", headers={"Authorization": f"Bearer {jeton}"}, json=_inventaire()
    )
    assert refuse.status_code == 403
    n = db.conn.execute("select count(*) from control_plane_events").fetchone()
    assert n is not None and n[0] == 0


def test_a_gotrue_deployment_is_untouched(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Le contrôle qui protège l'existant.

    Sans profil `oidc_groups`, aucune fédération n'est construite, `app_metadata.role`
    reste seul maître, et rien n'est écrit dans le journal de plan de contrôle. Une
    fonctionnalité nouvelle qui change le comportement d'un déploiement en place n'est
    pas une porte de plus, c'est une régression.
    """
    tid = _tenant(db)
    app = create_app(Settings(_env_file=None, env="dev", database_url=db.url))
    app.state.verifier = test_verifier
    client = TestClient(app)
    jeton = make_token(tenant_id=tid, role="admin", sub=_SUB)

    ecrit = client.put(
        "/v1/shadow-ai", headers={"Authorization": f"Bearer {jeton}"}, json=_inventaire()
    )
    assert ecrit.status_code == 200
    n = db.conn.execute("select count(*) from control_plane_events").fetchone()
    assert n is not None and n[0] == 0


def test_no_federation_is_built_without_the_profile() -> None:
    """Une variable qui traîne dans l'environnement ne doit rien activer."""
    settings = Settings(_env_file=None, issuer_group_roles="platform-admins:admin")
    assert build_federation(settings) is None
