"""`L3` — la route publique du relevé : ce qu'elle rend, et ce qu'elle refuse.

Elle existe à côté de `/v1/triage` pour une raison qui tient en une phrase : le
diagnostic demande une adresse et capture un lead, ce qui est un arbitrage commercial
assumé ; lire une liste de menaces sur une page publique ne doit rien demander. Les
deux premiers tests tiennent cette frontière.

Le reste tient le fail-closed. Une page commerciale sans carte publiée ne doit pas
afficher une liste vide : « aucune menace » est une réponse fausse bien plus coûteuse
qu'un encart d'indisponibilité.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from api import threats as threats_route
from api.main import create_app
from core.config import Settings


def _client() -> TestClient:
    # Aucune base : la route n'en touche pas, et le prouver ici est le test.
    return TestClient(create_app(Settings(_env_file=None, env="dev")))


def _get(client: TestClient, profiles: str = "") -> Any:
    return client.get(f"/v1/threats?profiles={profiles}")


# --- Ce que la route demande, et ne demande pas --------------------------------


def test_reading_the_threat_rows_needs_no_account_and_no_e_mail() -> None:
    """Ni session, ni adresse. C'est la moitié de la raison d'être de cette route."""
    resp = _get(_client(), "P1a,P3")
    assert resp.status_code == 200
    corps = resp.json()
    assert len(corps["rows"]) == 16
    # Rien qui ressemble à une collecte : le corps rendu ne porte aucun champ d'identité.
    assert "email" not in json.dumps(corps)


def test_the_route_answers_without_touching_the_database() -> None:
    """Construite sans `database_url`, elle répond quand même.

    Le diagnostic, lui, écrit un lead et ne peut pas. Ce test est la preuve que la
    séparation des deux routes n'est pas cosmétique.
    """
    app = create_app(Settings(_env_file=None, env="dev", database_url=None))
    resp = TestClient(app).get("/v1/threats?profiles=P3")
    assert resp.status_code == 200


# --- Les chiffres viennent du moteur -------------------------------------------


def test_the_counts_are_the_engine_s_and_they_count_lines() -> None:
    """`P1a` : 8 lignes applicables, 2 bloquées. Pas 3, qui est le compte de facettes."""
    corps = _get(_client(), "P1a").json()
    assert corps["counts"] == {"lines": 16, "applicable": 8, "ours": 5, "blocked": 2}
    assert "nous en bloquons 2 nativement" in corps["statement"]


def test_the_saas_ceiling_travels_with_the_answer() -> None:
    """`FR-174` : devant une IA embarquée SaaS, `Bloqué` est structurellement hors d'atteinte.

    La route ne doit pas pouvoir rendre une couverture que le déploiement interdit,
    même si la carte la publie ailleurs.
    """
    corps = _get(_client(), "P1b").json()
    assert corps["cap"] == "D"
    assert corps["counts"]["blocked"] == 0
    assert not any(f["mode"] == "B" for row in corps["rows"] for f in row["facets"])


def test_a_row_that_is_not_theirs_says_who_carries_it() -> None:
    """Une ligne non applicable nomme son porteur, ou la condition qui la ferait basculer."""
    corps = _get(_client(), "P1a").json()
    etrangeres = [row for row in corps["rows"] if not row["applicable"]]
    assert etrangeres, "P1a doit laisser des lignes hors périmètre, sinon le test ne dit rien"
    for row in etrangeres:
        assert row["owner"], f"{row['id']} ne dit pas à qui il revient"


def test_no_profile_yields_the_rows_but_no_statement() -> None:
    """Sans profil coché, il n'y a pas de client à qui parler : la liste, pas la phrase."""
    corps = _get(_client()).json()
    assert corps["profiles"] == []
    assert corps["statement"] is None
    assert len(corps["rows"]) == 16
    # Et rien n'est applicable, donc rien n'est revendiqué de personne.
    assert not any(row["applicable"] for row in corps["rows"])


# --- Fail-closed ---------------------------------------------------------------


def test_an_unknown_profile_is_refused_rather_than_ignored() -> None:
    """Ignorer un profil inconnu rendrait un diagnostic pour un usage qu'on n'a pas compris."""
    resp = _get(_client(), "P1a,P9")
    assert resp.status_code == 400
    assert "P9" in resp.json()["detail"]


def test_an_over_long_parameter_is_refused_before_being_parsed() -> None:
    """`CLAUDE.md` §4.9 : la longueur est bornée en amont, pas après découpage."""
    resp = _get(_client(), "P1a," * 200)
    assert resp.status_code == 422


def test_the_route_refuses_to_answer_without_a_published_map(
    monkeypatch: Any, tmp_path: Path
) -> None:
    """Sans carte, 503 — jamais une liste vide, qui se lirait « aucune menace ».

    Le même fail-closed que `/v1/triage`, et pour la même raison : ce qui n'est pas
    prouvé ne peut pas être annoncé (`CLAUDE.md` §9).
    """
    monkeypatch.setattr(threats_route, "_MAP", tmp_path / "absente.json")
    resp = _get(_client(), "P3")
    assert resp.status_code == 503
    # Le détail ne fuit pas le chemin du fichier au client (`CLAUDE.md` §4.8).
    assert "tmp" not in resp.json()["detail"]
