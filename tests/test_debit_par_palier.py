"""Le débit vendu par palier, appliqué — et les deux défauts qu'il découvre en chemin.

`0030` publie `authorize_rpm` (60 / 600 / 3000) et `proxy_rpm` (120 / 1200 / 6000) dans
les trois paliers. Rien ne les appliquait : `api/ratelimit.py` lisait deux chaînes de
configuration, si bien qu'un `entreprise` qui a payé 3000/min était bridé à 120 et
qu'un `free` qui a droit à 60 en obtenait 120. Le défaut est invisible **parce que la
limite s'applique** : la route répond, le 429 arrive, rien ne casse.

En câblant, deux choses se sont vues qui n'avaient rien à voir avec la gamme :

* `POST /v1/authorize` ne présente aucun `Authorization` — elle s'authentifie par
  `X-Gateway-Token`. Son compartiment retombait donc sur l'**adresse**, c'est-à-dire
  sur un compartiment unique partagé derrière un edge : n'importe quel client mettait
  tous les autres en 429 avec une boucle triviale, sur la route la plus chaude du
  produit. C'est exactement le défaut que l'en-tête d'`api/ratelimit.py` dit éviter.
* slowapi range ses compartiments **par chemin**. Les six routes du proxy en avaient
  donc six, et un agent multipliait son quota par six en changeant de fournisseur.

Et une régression que ce lot aurait pu introduire : deux fois la même limite dans la
même chaîne la **divise par deux**, parce que `limits` en fait deux items qui retombent
sur la même clé de stockage.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from api import ratelimit
from api.security import TokenVerifier
from cli.main import main as cli_main
from core import tenant_tokens
from core.config import Settings
from core.entitlements import Metric
from tests.conftest import DBHandle

UNE_COMPLETION: dict[str, Any] = {
    "id": "chatcmpl-debit",
    "object": "chat.completion",
    "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}}],
}


@pytest.fixture(autouse=True)
def _relais_vierge() -> Iterator[None]:
    ratelimit.oublier_debits()
    yield
    ratelimit.oublier_debits()


def _tenant(db: DBHandle, plan: str = "entreprise") -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name, plan) values (%s, 'D', %s)", (tid, plan))
    db.conn.commit()
    return tid


def _jeton(db: DBHandle, tenant_id: str) -> str:
    raw, _ = tenant_tokens.mint(db.conn, tenant_id=tenant_id, name="bot")
    db.conn.commit()
    return raw


def _plafonner(db: DBHandle, plan: str, metric: Metric, valeur: int) -> None:
    db.conn.execute(
        "update plan_limits set limit_value = %s where plan = %s and metric = %s",
        (valeur, plan, metric.value),
    )
    db.conn.commit()


# ---------------------------------------------------------------------------
# Le résolveur
# ---------------------------------------------------------------------------
def test_the_plan_limit_reaches_the_resolver_without_a_second_query(db: DBHandle) -> None:
    """Les deux débits voyagent avec le principal, lus dans la requête d'authentification.

    C'est la contrainte qui a dicté la forme : `perf/overhead.json` fige le coût de
    `/v1/authorize`, et `tests/test_overhead.py` mesure ce chemin **sans préchauffage**
    — donc même un cache à durée de vie courte serait mesuré à froid.
    """
    tenant = _tenant(db, "pro")
    raw = _jeton(db, tenant)
    token_id, resolu, authorize_rpm, proxy_rpm = tenant_tokens.authenticate_gateway_principal(
        db.conn, raw
    )
    assert (resolu, token_id) == (tenant, token_id)
    assert (authorize_rpm, proxy_rpm) == (600, 1200)


def test_a_negotiated_quota_wins_and_an_expired_one_does_not(db: DBHandle) -> None:
    """Même règle que `load_entitlement`, et pour la même raison : un override expiré
    doit retomber sur le chiffre du palier, jamais rester en vigueur."""
    tenant = _tenant(db, "free")
    raw = _jeton(db, tenant)
    db.conn.execute(
        "insert into tenant_quota_overrides (tenant_id, metric, limit_value, reason) "
        "values (%s, 'authorize_rpm', 999, 'negocie')",
        (tenant,),
    )
    db.conn.commit()
    assert tenant_tokens.authenticate_gateway_principal(db.conn, raw)[2] == 999

    db.conn.execute(
        "update tenant_quota_overrides set expires_at = now() - interval '1 day' "
        "where tenant_id = %s",
        (tenant,),
    )
    db.conn.commit()
    assert tenant_tokens.authenticate_gateway_principal(db.conn, raw)[2] == 60


def test_an_unresolved_caller_falls_back_to_the_infrastructure_ceiling() -> None:
    """**La direction d'échec.**

    Retomber sur le palier le plus restreint transformerait une lecture manquante en
    bridage d'un client qui a payé — un incident de facturation devenu incident de
    production, ce que `core/entitlements.tighten` refuse déjà pour les classes
    légères. Retomber sur le plafond d'infrastructure rend le comportement d'avant ce
    lot : une limite existe, elle n'est simplement pas commerciale.
    """
    assert ratelimit.authorize_rpm_limit("ip:1.2.3.4") == ratelimit.authorize_rate_limit()
    assert ratelimit.proxy_rpm_limit("ip:1.2.3.4") == ratelimit.llm_proxy_rate_limit()


def test_the_two_limits_are_composed_and_never_duplicated() -> None:
    """**Deux fois la même limite la divise par deux.**

    `limits` construit un `RateLimitItem` par morceau, et deux items identiques
    retombent sur la même clé de stockage : slowapi les frappe tous les deux, donc
    chaque requête consomme deux jetons. Un `entreprise` calé pile sur le plafond
    d'infrastructure — la configuration par défaut, précisément — serait limité à
    1500/minute au lieu de 3000, sans que rien ne le signale.
    """
    ratelimit.publier_debits("tenant:x", 600, 1200)
    assert (
        ratelimit.authorize_rpm_limit("tenant:x")
        == f"600/minute;{ratelimit.authorize_rate_limit()}"
    )

    plafond = ratelimit.authorize_rate_limit()
    ratelimit.publier_debits("tenant:y", int(plafond.split("/")[0]), 1)
    assert ratelimit.authorize_rpm_limit("tenant:y") == plafond, (
        "le palier et le plafond sont identiques et apparaissent deux fois : "
        "la limite effective est divisée par deux"
    )


# ---------------------------------------------------------------------------
# Le compartiment
# ---------------------------------------------------------------------------
def test_the_bucket_is_the_tenant_once_the_dependency_has_resolved_it() -> None:
    """La seule identité que l'appelant ne choisit pas — elle vient d'une lecture en base."""
    from starlette.requests import Request

    portee: dict[str, Any] = {"type": "http", "headers": [], "client": ("1.2.3.4", 1)}
    requete = Request(portee)
    assert ratelimit.client_key(requete).startswith("ip:")
    setattr(requete.state, ratelimit.ETAT_TENANT, "abc")
    assert ratelimit.client_key(requete) == "tenant:abc"


def test_two_tenants_no_longer_share_one_bucket_on_the_hot_route(
    db: DBHandle, test_verifier: TokenVerifier
) -> None:
    """Le défaut que le câblage a découvert, et il n'a rien à voir avec la gamme.

    `/v1/authorize` ne présente pas d'`Authorization` : son compartiment retombait sur
    l'adresse. Sous `TestClient`, tous les appelants ont la même — donc un tenant qui
    épuise son quota mettait tous les autres en 429.
    """
    from tests.test_llm_proxy import _client

    _plafonner(db, "free", Metric.authorize_rpm, 1)
    premier, second = _tenant(db, "free"), _tenant(db, "free")
    client: TestClient = _client(db.url, test_verifier)

    def appeler(raw: str) -> int:
        return client.post(
            "/v1/authorize",
            headers={"X-Gateway-Token": raw},
            json={"tool": "read_doc", "arguments": {}},
        ).status_code

    jeton_premier, jeton_second = _jeton(db, premier), _jeton(db, second)
    assert appeler(jeton_premier) != 429
    assert appeler(jeton_premier) == 429, "le plafond du palier ne s'applique pas"
    assert appeler(jeton_second) != 429, (
        "un tenant a épuisé le quota d'un autre : le compartiment est partagé"
    )


def test_the_six_proxy_routes_share_one_quota(
    db: DBHandle, test_verifier: TokenVerifier, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`proxy_rpm` est **un** quota vendu, il lui faut **un** compartiment.

    slowapi range par chemin (`key_style="url"`) : sans portée nommée, un agent
    multipliait son débit par six en changeant de fournisseur — ou simplement en
    passant du jeton en en-tête au jeton dans l'URL.
    """
    from tests.test_llm_proxy import _client, _FakeClient, _FakeResp

    _plafonner(db, "free", Metric.proxy_rpm, 2)
    tenant = _tenant(db, "free")
    raw = _jeton(db, tenant)
    monkeypatch.setattr("api.llm_proxy._http", lambda: _FakeClient(_FakeResp(UNE_COMPLETION)))
    client: TestClient = _client(db.url, test_verifier)
    entetes = {"X-Gateway-Token": raw, "Authorization": "Bearer sk"}
    corps = {"model": "m", "messages": [{"role": "user", "content": "x"}]}

    assert (
        client.post("/proxy/openai/v1/chat/completions", headers=entetes, json=corps).status_code
        != 429
    )
    assert (
        client.post("/proxy/mistral/v1/chat/completions", headers=entetes, json=corps).status_code
        != 429
    )
    troisieme = client.post("/proxy/openrouter/v1/chat/completions", headers=entetes, json=corps)
    assert troisieme.status_code == 429, (
        "les routes du proxy ont chacune leur compartiment : le quota vendu est "
        "multiplié par le nombre de fournisseurs"
    )


# ---------------------------------------------------------------------------
# Le plafond d'infrastructure
# ---------------------------------------------------------------------------
def test_doctor_refuses_a_ceiling_that_silently_throttles_what_was_sold(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    """Un plafond sous le plus haut palier ne casse rien — il bride, et c'est tout le mal.

    La route répond, le 429 arrive, tout a l'air normal. Seul un contrôle qui compare
    le plafond à la **grille publiée** peut le voir.
    """
    reglages = Settings(
        _env_file=None,
        env="dev",
        database_url=db.url,
        cors_allow_origins=["http://localhost:3000"],
        authorize_rate_limit="120/minute",
    )
    cli_main(["doctor"], settings=reglages)
    sortie = capsys.readouterr().out
    assert "[FAIL] ratelimit.authorize_rpm" in sortie
    assert "3000/min" in sortie
    assert "[OK  ] ratelimit.proxy_rpm" in sortie


def test_doctor_accepts_a_ceiling_at_the_top_of_the_published_grid(
    db: DBHandle, capsys: pytest.CaptureFixture[str]
) -> None:
    """Et l'égalité passe, parce que le résolveur déduplique. Sans la déduplication,
    cette configuration — celle par défaut — diviserait la limite par deux."""
    reglages = Settings(
        _env_file=None,
        env="dev",
        database_url=db.url,
        cors_allow_origins=["http://localhost:3000"],
    )
    cli_main(["doctor"], settings=reglages)
    sortie = capsys.readouterr().out
    assert "[OK  ] ratelimit.authorize_rpm" in sortie
    assert "[OK  ] ratelimit.proxy_rpm" in sortie
