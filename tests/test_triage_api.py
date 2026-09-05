"""QO-7 — le diagnostic public : la carte servie, et la donnée personnelle tenue.

L'utilisateur a tranché : l'e-mail est demandé **avant** le résultat. Cet arbitrage
commercial fait de cette route la seule du produit qui collecte de la donnée
personnelle sans tenant — un prospect n'en a pas. La moitié de ce fichier porte donc
sur ce que la route *ne fait pas* : elle ne journalise pas l'adresse, elle ne la rend
pas, elle ne la conserve pas indéfiniment, et elle n'invente pas de couverture quand
la carte manque.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient

from api import triage as triage_route
from api.main import create_app
from core import leads
from core.config import Settings
from tests.conftest import DBHandle

_ADRESSE = "prospect@exemple-client.test"


def _client(url: str) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=url))
    return TestClient(app)


def _post(client: TestClient, **kw: Any) -> Any:
    body = {"profiles": ["P1a", "P2", "P3"], "email": _ADRESSE, **kw}
    return client.post("/v1/triage", json=body)


def test_the_diagnostic_answers_from_the_generated_map(db: DBHandle) -> None:
    """La carte servie est l'artefact **généré**, donc adossé aux scénarios.

    C'est ce qui empêche l'écran d'annoncer plus que ce que le produit prouve : la
    borne n'est pas une relecture commerciale, c'est `CM-7`.
    """
    resp = _post(_client(db.url))
    assert resp.status_code == 200
    body = resp.json()
    assert body["lines"] == 16
    assert body["applicable"] > 0
    assert body["blocked"] <= body["ours"] <= body["applicable"]
    assert "vous concernent réellement" in body["statement"]


def test_the_purpose_travels_with_the_answer(db: DBHandle) -> None:
    """La finalité est dans la réponse, pas sur une page qu'il faut aller chercher.

    Une finalité qu'il faut aller chercher n'a pas été portée à la connaissance de la
    personne — et une refonte du site ne peut pas la faire disparaître si elle voyage
    avec la donnée.
    """
    body = _post(_client(db.url)).json()
    assert "intérêt légitime" in body["privacy"]
    assert str(leads.RETENTION_DAYS) in body["privacy"]
    assert "suppression" in body["privacy"]


def test_the_capture_is_stored_and_minimised(db: DBHandle) -> None:
    """Minimisation : e-mail, profils, horodatage. Rien d'autre n'est collecté."""
    assert _post(_client(db.url)).status_code == 200

    with psycopg.connect(db.url) as check:
        rows = check.execute("select email, profiles from triage_leads").fetchall()
        colonnes = {
            r[0]
            for r in check.execute(
                "select column_name from information_schema.columns "
                "where table_name = 'triage_leads'"
            ).fetchall()
        }
    assert rows == [(_ADRESSE, ["P1a", "P2", "P3"])]
    # Ce qui n'est pas collecté n'a pas à être protégé : la table ne peut pas porter
    # d'IP ni d'user-agent, et ce test tomberait si une colonne apparaissait.
    assert colonnes == {"id", "email", "profiles", "created_at"}


def test_the_address_never_reaches_the_response(db: DBHandle) -> None:
    """La route ne renvoie pas l'adresse — la lui rendre inviterait à la journaliser."""
    body = _post(_client(db.url)).json()
    assert _ADRESSE not in json.dumps(body)


def test_the_address_never_reaches_the_logs(db: DBHandle, caplog: pytest.LogCaptureFixture) -> None:
    """`CLAUDE.md` §4.10 : métadonnées et empreinte, jamais le contenu.

    Assertion sur les journaux *réellement émis* plutôt que sur une relecture du code :
    c'est la forme que prend la règle quand on la vérifie au lieu de la promettre.
    """
    with caplog.at_level("DEBUG"):
        assert _post(_client(db.url)).status_code == 200
    assert _ADRESSE not in caplog.text


def test_the_capture_returns_a_fingerprint_not_the_address(db: DBHandle) -> None:
    """`capture` rend l'empreinte : elle corrèle sans réidentifier à elle seule."""
    lead = leads.capture(db.conn, email=_ADRESSE, profiles=["P2"])
    db.conn.commit()
    assert lead.email_sha256 == leads.email_fingerprint(_ADRESSE)
    assert _ADRESSE not in repr(lead)


def test_expired_captures_are_purged(db: DBHandle) -> None:
    """Rétention **plafonnée**, à l'inverse du plancher qui protège la piste d'audit.

    Les deux sont des rétentions et ne bornent pas du même côté : là, conserver trop
    peu affaiblit une preuve ; ici, conserver trop longtemps est le manquement.
    """
    leads.capture(db.conn, email="vieux@exemple.test", profiles=["P2"])
    leads.capture(db.conn, email="recent@exemple.test", profiles=["P2"])
    db.conn.execute(
        "update triage_leads set created_at = %s where email = 'vieux@exemple.test'",
        (datetime.now(UTC) - timedelta(days=leads.RETENTION_DAYS + 1),),
    )
    db.conn.commit()

    assert leads.purge_expired(db.conn) == 1
    db.conn.commit()
    restants = db.conn.execute("select email from triage_leads").fetchall()
    assert restants == [("recent@exemple.test",)]


def test_an_absent_map_refuses_rather_than_inventing(
    db: DBHandle, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Fail-closed : sans carte publiée, rien n'est prouvé, donc rien n'est annoncé.

    Le mode d'échec à éviter n'est pas l'indisponibilité, c'est une couverture
    inventée montrée à un prospect.
    """
    monkeypatch.setattr(triage_route, "_MAP", tmp_path / "absente.json")
    resp = _post(_client(db.url))
    assert resp.status_code == 503
    with psycopg.connect(db.url) as check:
        assert check.execute("select count(*) from triage_leads").fetchone() == (0,)


def test_an_unknown_profile_is_refused(db: DBHandle) -> None:
    assert _post(_client(db.url), profiles=["P9"]).status_code == 422


def test_an_empty_profile_list_is_refused(db: DBHandle) -> None:
    """Aucun profil coché ne produit pas un diagnostic vide : il ne produit rien."""
    assert _post(_client(db.url), profiles=[]).status_code == 422


def test_an_extra_field_is_refused(db: DBHandle) -> None:
    """`extra="forbid"` : sur une route publique, un champ inconnu est une sonde."""
    assert _post(_client(db.url), societe="ACME").status_code == 422
