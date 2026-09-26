"""Règles sur mesure de bout en bout, sur un vrai PostgreSQL (RLS, triggers, chaîne).

Qui compose et signe (l'opérateur xSOM, seul), qui lit (le client, sous RLS), qui
récupère (le poste enrôlé, pour son tenant) — et ce qui n'est jamais écrit nulle part :
les termes confidentiels en clair et le texte d'essai.
"""

from __future__ import annotations

import base64
import logging
from collections.abc import Callable, Iterator
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from pydantic import ValidationError

from api.main import create_app
from api.security import TokenVerifier
from core import db as core_db
from core import extension_devices, rules_packs, tenant_tokens
from core.config import Settings, get_settings
from tests.conftest import DBHandle

_SEED = base64.b64encode(bytes(range(32))).decode("ascii")
_PUBLIC = base64.b64decode(rules_packs.Ed25519Signer(bytes(range(32))).public_key)
_KEY_ID = rules_packs.Ed25519Signer(bytes(range(32))).key_id
_SECRETS = ("faucon", "nébuleuse", "nebuleuse", "zx-essai-marqueur")


def _app(
    db: DBHandle, verifier: TokenVerifier, operator: str, *, signing: bool = True
) -> TestClient:
    settings = Settings(
        _env_file=None,
        env="dev",
        database_url=db.url,
        xsom_rules_signing_key=_SEED if signing else None,
        xsom_operator_subjects=operator,
    )
    app = create_app(settings)
    app.state.verifier = verifier
    return TestClient(app)


def _tenant(db: DBHandle, name: str) -> str:
    tenant = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, %s)", (tenant, name))
    db.conn.commit()
    return tenant


def _device(client: TestClient, db: DBHandle, tenant: str, name: str) -> dict[str, str]:
    raw, _ = tenant_tokens.mint(db.conn, tenant_id=tenant, name=name)
    headers = {"X-Gateway-Token": raw}
    registered = client.post(
        "/v1/extension/register",
        headers=headers,
        json={
            "installation_id": str(uuid4()),
            "platform": "linux",
            "extension_version": "0.6.1",
            "mode": "block",
        },
    )
    assert registered.status_code == 200, registered.text
    return headers


def _draft(terms: list[str] | None = None) -> dict[str, Any]:
    return {
        "packId": "acme-main",
        "validityDays": 365,
        "detectors": [
            {
                "id": "acme.customer-id",
                "label": "Identifiant client ACME",
                "category": "customer_data",
                "action": "block",
                "match": {"type": "pattern", "pattern": "CLI-[0-9]{8}"},
            },
            {
                "id": "acme.siret",
                "label": "Numéro SIRET d'un client",
                "category": "customer_data",
                "action": "warn",
                "match": {"type": "pattern", "pattern": "[0-9]{14}"},
                "context": {"keywords": ["siret"], "window": 24},
            },
            {
                "id": "acme.codenames",
                "label": "Nom de code de projet",
                "category": "project",
                "action": "block",
                "match": {"type": "terms", "terms": terms},
            },
        ],
        "tests": {
            "positives": [
                {"detector": "acme.customer-id", "text": "Le client CLI-00421337 a appelé."},
                {"detector": "acme.siret", "text": "SIRET 55210055400013 — facture jointe."},
            ],
            "negatives": ["Le ticket JIRA-12345678 est clos."],
        },
    }


def _bearer(make_token: Callable[..., str], **claims: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(**claims)}"}


def _publish(
    client: TestClient, operator: dict[str, str], tenant: str, expected: int, **kw: Any
) -> Any:
    return client.post(
        f"/v1/xsom/tenants/{tenant}/rules-pack/publish",
        headers=operator,
        json={"draft": _draft(**kw), "expectedVersion": expected},
    )


@pytest.fixture
def operator_sub() -> str:
    return str(uuid4())


def test_operator_signs_and_the_workstation_fetches_a_verifiable_envelope(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    operator_sub: str,
) -> None:
    tenant = _tenant(db, "ACME")
    client = _app(db, test_verifier, operator_sub)
    workstation = _device(client, db, tenant, "PC-ACME")
    operator = _bearer(make_token, sub=operator_sub, tenant_id=_tenant(db, "xSOM"), role="admin")

    assert client.get("/v1/extension/rules-pack", headers=workstation).json() == {"rulesPack": None}

    first = _publish(client, operator, tenant, 0, terms=["Projet Faucon", "Nébuleuse"])
    assert first.status_code == 200, first.text
    assert first.json()["version"] == 1 and first.json()["keyId"] == _KEY_ID

    fetched = client.get("/v1/extension/rules-pack", headers=workstation).json()["rulesPack"]
    assert fetched["payload"]["tenantId"] == tenant
    assert fetched["payload"]["version"] == 1
    assert rules_packs.verify_envelope(fetched, {_KEY_ID: _PUBLIC})
    assert rules_packs.payload_digest(fetched["payload"]) == first.json()["payloadDigest"]
    rules_packs.validate(fetched["payload"])

    # Deux publications croisées ne s'écrasent pas : la version vue doit être la dernière.
    stale = _publish(client, operator, tenant, 0, terms=["Projet Faucon"])
    assert stale.status_code == 409
    second = _publish(client, operator, tenant, 1)  # termes non ressaisis : conservés
    assert second.status_code == 200, second.text
    assert second.json()["version"] == 2
    envelope = client.get("/v1/extension/rules-pack", headers=workstation).json()["rulesPack"]
    kept = envelope["payload"]["detectors"][2]["match"]
    assert kept == fetched["payload"]["detectors"][2]["match"]

    admin = client.get(
        "/v1/rules-pack", headers=_bearer(make_token, tenant_id=tenant, role="admin")
    )
    assert admin.status_code == 200
    view = admin.json()
    assert view["pack"]["version"] == 2
    assert view["chainIntact"] is True
    assert view["xsomOperator"] is False
    detectors = {d["id"]: d for d in view["pack"]["detectors"]}
    assert detectors["acme.customer-id"]["pattern"] == "CLI-[0-9]{8}"
    assert detectors["acme.codenames"]["termsCount"] == 2
    assert "digests" not in admin.text and "salt" not in admin.text
    assert [entry["version"] for entry in view["history"]] == [2, 1]

    viewer = client.get(
        "/v1/rules-pack", headers=_bearer(make_token, tenant_id=tenant, role="viewer")
    )
    assert "CLI-[0-9]{8}" not in viewer.text
    assert viewer.json()["pack"]["version"] == 2


def test_authorization_matrix(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    operator_sub: str,
) -> None:
    tenant = _tenant(db, "ACME")
    other = _tenant(db, "Other")
    client = _app(db, test_verifier, operator_sub)
    other_device = _device(client, db, other, "PC-OTHER")
    operator = _bearer(make_token, sub=operator_sub, tenant_id=other, role="viewer")
    assert _publish(client, operator, tenant, 0, terms=["Projet Faucon"]).status_code == 200

    routes: list[tuple[str, str, dict[str, Any] | None]] = [
        ("GET", "/v1/xsom/tenants", None),
        ("GET", f"/v1/xsom/tenants/{tenant}/rules-pack", None),
        (
            "POST",
            f"/v1/xsom/tenants/{tenant}/rules-pack/dry-run",
            {"draft": _draft(), "sample": "CLI-12345678"},
        ),
        (
            "POST",
            f"/v1/xsom/tenants/{tenant}/rules-pack/publish",
            {"draft": _draft(), "expectedVersion": 1},
        ),
        ("POST", f"/v1/xsom/tenants/{tenant}/rules-pack/revoke", {"version": 1}),
    ]
    callers = {
        "tenant admin": (_bearer(make_token, tenant_id=tenant, role="admin"), 403),
        "tenant operator": (_bearer(make_token, tenant_id=tenant, role="operator"), 403),
        "tenant viewer": (_bearer(make_token, tenant_id=tenant, role="viewer"), 403),
        "other tenant admin": (_bearer(make_token, tenant_id=other, role="admin"), 403),
        "no token": ({}, 401),
        "workstation token": (other_device, 401),
    }
    for label, (headers, expected) in callers.items():
        for method, path, body in routes:
            response = client.request(method, path, headers=headers, json=body)
            assert response.status_code == expected, (label, method, path, response.text)

    # Personne n'a rien publié de plus : la version reste 1.
    assert rules_packs.current(db.conn, tenant).version == 1  # type: ignore[union-attr]

    # Le poste d'un autre tenant récupère le réglage de SON tenant : aucun.
    assert client.get("/v1/extension/rules-pack", headers=other_device).json() == {
        "rulesPack": None
    }
    # Le client d'un autre tenant ne lit rien du premier (RLS).
    foreign = client.get(
        "/v1/rules-pack", headers=_bearer(make_token, tenant_id=other, role="admin")
    ).json()
    assert foreign["pack"] is None and foreign["history"] == []

    # Un poste inconnu, un jeton absent : mêmes erreurs que /v1/extension/policy.
    assert client.get("/v1/extension/rules-pack").status_code == 401
    raw, _ = tenant_tokens.mint(db.conn, tenant_id=tenant, name="PC-UNREGISTERED")
    unregistered = {"X-Gateway-Token": raw}
    assert client.get("/v1/extension/rules-pack", headers=unregistered).status_code == 404
    assert client.get("/v1/extension/policy", headers=unregistered).status_code == 404

    # Liste d'opérateurs vide : plus personne n'est opérateur, pas même le même sujet.
    closed = _app(db, test_verifier, "")
    assert closed.get("/v1/xsom/tenants", headers=operator).status_code == 403
    assert closed.get("/v1/me", headers=operator).json()["xsom_operator"] is False
    assert client.get("/v1/me", headers=operator).json()["xsom_operator"] is True


def test_publishing_fails_closed_without_a_signing_key(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    operator_sub: str,
) -> None:
    tenant = _tenant(db, "ACME")
    client = _app(db, test_verifier, operator_sub, signing=False)
    operator = _bearer(make_token, sub=operator_sub, tenant_id=tenant, role="admin")
    refused = _publish(client, operator, tenant, 0, terms=["Projet Faucon"])
    assert refused.status_code == 503
    assert refused.json()["detail"]["code"] == "signing_unavailable"
    assert db.conn.execute("select count(*) from rules_pack_events").fetchone() == (0,)
    trial = client.post(
        f"/v1/xsom/tenants/{tenant}/rules-pack/dry-run",
        headers=operator,
        json={"draft": _draft(["Projet Faucon"]), "sample": "CLI-12345678"},
    )
    assert trial.status_code == 200 and trial.json()["valid"] is True
    view = client.get(f"/v1/xsom/tenants/{tenant}/rules-pack", headers=operator).json()
    assert view["signingReady"] is False and view["pack"] is None
    reader = client.get("/v1/rules-pack", headers=_bearer(make_token, tenant_id=tenant))
    assert reader.status_code == 200 and reader.json()["pack"] is None


def test_history_is_append_only_monotonic_and_chained(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    operator_sub: str,
) -> None:
    tenant = _tenant(db, "ACME")
    client = _app(db, test_verifier, operator_sub)
    operator = _bearer(make_token, sub=operator_sub, tenant_id=tenant, role="admin")
    assert _publish(client, operator, tenant, 0, terms=["Projet Faucon"]).status_code == 200
    assert _publish(client, operator, tenant, 1).status_code == 200
    assert rules_packs.verify_chain(db.conn, tenant).ok

    row = db.conn.execute(
        "select payload, key_id, public_key, signature, payload_digest, expires_at, "
        "entry_digest, prev_hash, entry_hash from rules_pack_events where version = 1"
    ).fetchone()
    assert row is not None
    replay = (
        "insert into rules_pack_events (tenant_id, event, pack_id, version, payload, key_id, "
        "public_key, signature, payload_digest, expires_at, created_by, entry_digest, "
        "prev_hash, entry_hash) values (%s, 'published', 'acme-main', %s, %s::jsonb, %s, %s, "
        "%s, %s, %s, 'x', %s, %s, %s)"
    )
    for version in (1, 2):  # un retour en arrière ou un doublon est refusé par la base
        with pytest.raises(psycopg.Error, match=r"version must increase|duplicate"):
            db.conn.execute(replay, (tenant, version, psycopg.types.json.Jsonb(row[0]), *row[1:]))
        db.conn.rollback()
    for statement in (
        "update rules_pack_events set created_by = 'x'",
        "delete from rules_pack_events",
        "truncate rules_pack_events",
    ):
        with pytest.raises(psycopg.Error, match="append-only"):
            db.conn.execute(statement)
        db.conn.rollback()
    with pytest.raises(psycopg.Error, match="only a published"):
        db.conn.execute(
            "insert into rules_pack_events (tenant_id, event, pack_id, version, payload_digest, "
            "created_by, entry_digest, prev_hash, entry_hash) "
            "values (%s, 'revoked', 'acme-main', 9, %s, 'x', 'x', 'x', 'x')",
            (tenant, "0" * 64),
        )
    db.conn.rollback()

    # Une ligne glissée hors de l'application casse la chaîne, et la console le dit.
    db.conn.execute(replay, (tenant, 3, psycopg.types.json.Jsonb(row[0]), *row[1:]))
    db.conn.commit()
    assert not rules_packs.verify_chain(db.conn, tenant).ok
    view = client.get("/v1/rules-pack", headers=_bearer(make_token, tenant_id=tenant)).json()
    assert view["chainIntact"] is False


def test_revocation_is_its_own_record_and_stops_distribution(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    operator_sub: str,
) -> None:
    tenant = _tenant(db, "ACME")
    client = _app(db, test_verifier, operator_sub)
    workstation = _device(client, db, tenant, "PC-ACME")
    operator = _bearer(make_token, sub=operator_sub, tenant_id=tenant, role="admin")
    assert _publish(client, operator, tenant, 0, terms=["Projet Faucon"]).status_code == 200
    revoke = f"/v1/xsom/tenants/{tenant}/rules-pack/revoke"
    assert client.post(revoke, headers=operator, json={"version": 1}).status_code == 204
    assert client.post(revoke, headers=operator, json={"version": 1}).status_code == 404
    assert client.get("/v1/extension/rules-pack", headers=workstation).json() == {"rulesPack": None}
    events = db.conn.execute("select event, version from rules_pack_events order by id").fetchall()
    assert events == [("published", 1), ("revoked", 1)]
    assert rules_packs.verify_chain(db.conn, tenant).ok
    # Une version retirée ne prête pas ses empreintes : il faut ressaisir les termes.
    reused = _publish(client, operator, tenant, 1)
    assert reused.status_code == 422
    assert reused.json()["detail"]["code"] == "terms_required"
    assert _publish(client, operator, tenant, 1, terms=["Projet Faucon"]).status_code == 200
    served = client.get("/v1/extension/rules-pack", headers=workstation).json()["rulesPack"]
    assert served["payload"]["version"] == 2


def test_a_revocation_during_publication_is_a_conflict(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    operator_sub: str,
) -> None:
    tenant = _tenant(db, "ACME")
    client = _app(db, test_verifier, operator_sub)
    operator = _bearer(make_token, sub=operator_sub, tenant_id=tenant, role="admin")
    assert _publish(client, operator, tenant, 0, terms=["Projet Faucon"]).status_code == 200
    latest = rules_packs.current(db.conn, tenant)
    assert latest is not None
    payload = {**latest.payload, "version": 2}
    assert rules_packs.revoke(db.conn, tenant_id=tenant, version=1, revoked_by="x")
    db.conn.commit()
    with pytest.raises(rules_packs.VersionConflict):
        rules_packs.publish(
            db.conn,
            tenant_id=tenant,
            payload=payload,
            expected_version=1,
            signing=rules_packs.Ed25519Signer(bytes(range(32))),
            created_by="x",
            expected_revoked=False,
        )


def _everything_stored(db: DBHandle) -> str:
    """Toutes les lignes de toutes les tables du schéma public, en texte."""
    tables = [
        row[0]
        for row in db.conn.execute(
            "select tablename from pg_tables where schemaname = 'public'"
        ).fetchall()
    ]
    dump: list[str] = []
    for table in tables:
        for (text,) in db.conn.execute(
            sql.SQL("select t::text from {} t").format(sql.Identifier(table))
        ).fetchall():
            dump.append(text)
    return "\n".join(dump).lower()


def test_clear_terms_and_the_test_text_are_never_stored_or_logged(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    operator_sub: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    tenant = _tenant(db, "ACME")
    client = _app(db, test_verifier, operator_sub)
    operator = _bearer(make_token, sub=operator_sub, tenant_id=tenant, role="admin")
    trial = client.post(
        f"/v1/xsom/tenants/{tenant}/rules-pack/dry-run",
        headers=operator,
        json={
            "draft": _draft(["Projet Faucon", "Nébuleuse"]),
            "sample": "ZX-ESSAI-MARQUEUR : projet faucon et CLI-12345678",
        },
    )
    assert trial.status_code == 200 and trial.json()["valid"] is True
    assert [d["detector"] for d in trial.json()["detections"]] == [
        "acme.codenames",
        "acme.customer-id",
    ]
    assert (
        _publish(client, operator, tenant, 0, terms=["Projet Faucon", "Nébuleuse"]).status_code
        == 200
    )
    stored = _everything_stored(db)
    logged = "\n".join(
        f"{record.getMessage()} {record.__dict__}" for record in caplog.records
    ).lower()
    for secret in _SECRETS:
        assert secret not in stored, secret
        assert secret not in logged, secret
    # La graine de la clé d'autorité non plus : seule la clé publique est dérivée.
    assert _SEED.lower() not in stored and _SEED.lower() not in logged


def test_a_positive_that_would_reveal_a_term_is_refused(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    operator_sub: str,
) -> None:
    """Un positif est signé en clair : il ne doit jamais contenir un terme confidentiel."""
    tenant = _tenant(db, "ACME")
    client = _app(db, test_verifier, operator_sub)
    operator = _bearer(make_token, sub=operator_sub, tenant_id=tenant, role="admin")
    for detector, text in (
        ("acme.codenames", "Réunion Projet Faucon"),
        ("acme.customer-id", "CLI-12345678 pour le projet faucon"),
    ):
        draft = _draft(["Projet Faucon"])
        draft["tests"]["positives"].append({"detector": detector, "text": text})
        trial = client.post(
            f"/v1/xsom/tenants/{tenant}/rules-pack/dry-run", headers=operator, json={"draft": draft}
        ).json()
        assert trial["valid"] is False
        assert trial["error"]["code"] == "test_reveals_term"
        assert trial["error"]["detector"] == "acme.codenames"
        published = client.post(
            f"/v1/xsom/tenants/{tenant}/rules-pack/publish",
            headers=operator,
            json={"draft": draft, "expectedVersion": 0},
        )
        assert published.status_code == 422
        assert "faucon" not in published.text.lower()
    assert "faucon" not in _everything_stored(db)


@pytest.mark.parametrize(
    ("where", "code"),
    [("negative", "negative_reveals_term"), ("label", "field_reveals_term")],
)
def test_a_term_hidden_by_its_context_still_cannot_travel_in_clear(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    operator_sub: str,
    where: str,
    code: str,
) -> None:
    """Sans son mot-clé, le terme ne déclenche rien ; il serait pourtant signé en clair."""
    tenant = _tenant(db, "ACME")
    client = _app(db, test_verifier, operator_sub)
    operator = _bearer(make_token, sub=operator_sub, tenant_id=tenant, role="admin")
    draft = _draft(["Projet Faucon"])
    draft["detectors"][2]["context"] = {"keywords": ["code"], "window": 16}
    if where == "negative":
        draft["tests"]["negatives"].append("Le projet Faucon avance bien.")
    else:
        draft["detectors"][0]["label"] = "Client du projet Faucon"
    trial = client.post(
        f"/v1/xsom/tenants/{tenant}/rules-pack/dry-run", headers=operator, json={"draft": draft}
    ).json()
    assert trial["valid"] is False
    assert trial["error"]["code"] == code


def test_a_refused_body_is_never_echoed(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    operator_sub: str,
) -> None:
    """FastAPI renvoie la valeur refusée par défaut ; pas sur les routes de l'atelier."""
    tenant = _tenant(db, "ACME")
    client = _app(db, test_verifier, operator_sub)
    operator = _bearer(make_token, sub=operator_sub, tenant_id=tenant, role="admin")
    path = f"/v1/xsom/tenants/{tenant}/rules-pack/dry-run"
    marker = "zx-essai-marqueur"
    too_long_term = client.post(
        path, headers=operator, json={"draft": _draft([marker + " " + "x" * 200])}
    )
    too_long_sample = client.post(
        path, headers=operator, json={"draft": _draft(["a"]), "sample": marker * 2000}
    )
    for response in (too_long_term, too_long_sample):
        assert response.status_code == 422
        assert marker not in response.text
        assert response.json()["detail"][0]["loc"]


def test_dry_run_explains_refusals_and_counts_utf16(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    operator_sub: str,
) -> None:
    tenant = _tenant(db, "ACME")
    client = _app(db, test_verifier, operator_sub)
    operator = _bearer(make_token, sub=operator_sub, tenant_id=tenant, role="admin")
    path = f"/v1/xsom/tenants/{tenant}/rules-pack/dry-run"

    emoji = client.post(
        path,
        headers=operator,
        json={"draft": _draft(["Projet Faucon"]), "sample": "🔒CLI-12345678"},
    ).json()
    assert emoji["detections"][0]["start"] == 2 and emoji["detections"][0]["end"] == 14

    broken = _draft(["Projet Faucon"])
    broken["detectors"][0]["match"]["pattern"] = "CLI-\\d+"
    refused = client.post(path, headers=operator, json={"draft": broken}).json()
    assert refused["valid"] is False
    assert refused["error"] == {
        "code": "invalid_pattern",
        "detector": "acme.customer-id",
        "test": None,
        "reason": "unbounded_quantifier",
    }

    missing = client.post(path, headers=operator, json={"draft": _draft()}).json()
    assert missing["valid"] is False
    assert missing["error"]["code"] == "terms_required"

    unknown = f"/v1/xsom/tenants/{uuid4()}/rules-pack/dry-run"
    assert client.post(unknown, headers=operator, json={"draft": _draft()}).status_code == 404


@pytest.fixture
def _low_rules_limit(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("RULES_PACK_RATE_LIMIT", "2/minute")
    get_settings.cache_clear()
    try:
        yield
    finally:
        get_settings.cache_clear()


def test_the_dry_run_is_rate_limited(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    operator_sub: str,
    _low_rules_limit: None,
) -> None:
    tenant = _tenant(db, "ACME")
    client = _app(db, test_verifier, operator_sub)
    operator = _bearer(make_token, sub=operator_sub, tenant_id=tenant, role="admin")
    path = f"/v1/xsom/tenants/{tenant}/rules-pack/dry-run"
    body = {"draft": _draft(["Projet Faucon"])}
    codes = [client.post(path, headers=operator, json=body).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    publish = f"/v1/xsom/tenants/{tenant}/rules-pack/publish"
    published = [
        client.post(
            publish, headers=operator, json={**body, "expectedVersion": version}
        ).status_code
        for version in range(3)
    ]
    assert published == [200, 200, 429]


def test_rls_keeps_each_tenant_to_its_own_packs(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    operator_sub: str,
) -> None:
    acme = _tenant(db, "ACME")
    other = _tenant(db, "Other")
    client = _app(db, test_verifier, operator_sub)
    operator = _bearer(make_token, sub=operator_sub, tenant_id=acme, role="admin")
    assert _publish(client, operator, acme, 0, terms=["Projet Faucon"]).status_code == 200
    with core_db.tenant_reader(db.url, user_id="u", tenant_id=other, role="admin") as conn:
        assert conn.execute("select count(*) from rules_pack_events").fetchone() == (0,)
    with core_db.tenant_reader(db.url, user_id="u", tenant_id=acme, role="admin") as conn:
        assert conn.execute("select count(*) from rules_pack_events").fetchone() == (1,)
    with (
        pytest.raises(psycopg.errors.InsufficientPrivilege),
        core_db.tenant_reader(db.url, user_id="u", tenant_id=acme, role="admin") as conn,
    ):
        conn.execute(
            "insert into rules_pack_events (tenant_id, event, pack_id, version, "
            "payload_digest, created_by, entry_digest, prev_hash, entry_hash) "
            "values (%s, 'revoked', 'acme-main', 1, %s, 'x', 'x', 'x', 'x')",
            (acme, "0" * 64),
        )


def _event(kind: str, **fields: Any) -> dict[str, Any]:
    return {
        "event_id": str(uuid4()),
        "at": "2026-09-26T10:00:00Z",
        "kind": kind,
        "assistant": "secretguard",
        "mode": "block",
        "outcome": "configured",
        **fields,
    }


def test_workstations_report_the_applied_pack_and_the_console_counts_them(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    operator_sub: str,
) -> None:
    tenant = _tenant(db, "ACME")
    client = _app(db, test_verifier, operator_sub)
    operator = _bearer(make_token, sub=operator_sub, tenant_id=tenant, role="admin")
    published = _publish(client, operator, tenant, 0, terms=["Projet Faucon"]).json()
    current = published["payloadDigest"]
    fresh, stale, refusing = (
        _device(client, db, tenant, name) for name in ("PC-1", "PC-2", "PC-3")
    )
    synced = _event(
        "rules_pack_synced",
        rules_pack_id="acme-main",
        rules_pack_version=1,
        rules_pack_digest=current,
        custom_findings=2,
        custom_detector_ids=["acme.customer-id", "acme.codenames"],
    )
    for headers, events in (
        (fresh, [synced]),
        (stale, [_event("posture")]),
        (
            refusing,
            [_event("posture", outcome="unverified", posture_reasons=["rules_pack_rejected"])],
        ),
    ):
        response = client.post("/v1/extension/events", headers=headers, json={"events": events})
        assert response.status_code == 200, response.text
    coverage = client.get(
        "/v1/rules-pack", headers=_bearer(make_token, tenant_id=tenant, role="admin")
    ).json()["coverage"]
    assert {k: coverage[k] for k in ("total", "up_to_date", "behind", "refused")} == {
        "total": 3,
        "up_to_date": 1,
        "behind": 1,
        "refused": 1,
    }
    by_name = {device["name"]: device for device in coverage["devices"]}
    assert by_name["PC-1"]["appliedVersion"] == 1
    inventory = client.get(
        "/v1/extensions/devices", headers=_bearer(make_token, tenant_id=tenant, role="admin")
    ).json()
    applied = {row["name"]: row["rules_pack"] for row in inventory}
    assert applied["PC-1"]["rules_pack_digest"] == current
    assert applied["PC-2"] is None


@pytest.mark.parametrize(
    "fields",
    [
        {"rules_pack_digest": "A" * 64},
        {"rules_pack_version": 0},
        {"rules_pack_id": "Acme Main"},
        {"custom_findings": 10001},
        {"custom_detector_ids": ["a"] * 2},
        {"custom_detector_ids": [f"d{i}" for i in range(21)]},
        {"posture_reasons": ["rules_pack_unknown"]},
    ],
)
def test_malformed_pack_evidence_is_refused(fields: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        extension_devices.Event.model_validate(_event("rules_pack_synced", **fields))


@pytest.mark.parametrize("field", ["text", "value", "match", "prompt", "terms"])
def test_pack_evidence_refuses_any_content_field(field: str) -> None:
    with pytest.raises(ValidationError):
        extension_devices.Event.model_validate(
            _event("rules_pack_synced", rules_pack_digest="a" * 64, **{field: "CLI-12345678"})
        )


def test_pack_evidence_carries_no_content() -> None:
    event = extension_devices.Event.model_validate(
        _event(
            "posture",
            posture_reasons=["rules_pack_rejected", "rules_pack_expired"],
            rules_pack_id="acme-main",
            rules_pack_version=3,
            rules_pack_digest="a" * 64,
            custom_findings=0,
            custom_detector_ids=["acme.customer-id"],
        )
    )
    assert event.kind == "posture"
    assert set(extension_devices.Event.model_fields) >= {
        "rules_pack_id",
        "rules_pack_version",
        "rules_pack_digest",
        "custom_findings",
        "custom_detector_ids",
    }


def test_a_bad_or_reused_signing_key_refuses_to_boot() -> None:
    other = base64.b64encode(bytes(range(1, 33))).decode("ascii")
    for key, extra in (
        ("not-base64!", {}),
        (base64.b64encode(b"short").decode("ascii"), {}),
        (_SEED, {"developer_policy_signing_key": _SEED}),
        (_SEED, {"checkpoint_signing_key": _SEED}),
    ):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, env="dev", xsom_rules_signing_key=key, **extra)
    settings = Settings(
        _env_file=None, env="dev", xsom_rules_signing_key=_SEED, developer_policy_signing_key=other
    )
    assert _SEED not in repr(settings)


def test_federated_deployments_have_no_xsom_operator(operator_sub: str) -> None:
    """En `oidc_groups`, l'IdP du client émet les `sub` : il pourrait frapper celui d'xSOM."""
    from api.security import is_xsom_operator
    from core.schemas import CurrentUser

    user = CurrentUser(user_id=operator_sub, tenant_id=str(uuid4()))
    direct = Settings(_env_file=None, env="dev", xsom_operator_subjects=operator_sub)
    federated = direct.model_copy(update={"issuer_claims": "oidc_groups"})
    assert is_xsom_operator(direct, user) is True
    assert is_xsom_operator(federated, user) is False


def test_a_malformed_operator_list_refuses_to_boot() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, env="dev", xsom_operator_subjects="alice@xsom.fr")
    settings = Settings(
        _env_file=None,
        env="dev",
        xsom_operator_subjects=" 6F1C2A3E-0000-4000-8000-000000000001 ,",
    )
    assert settings.xsom_operators == frozenset({"6f1c2a3e-0000-4000-8000-000000000001"})
