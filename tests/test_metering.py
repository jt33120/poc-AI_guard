"""Ce que le produit compte, et sur quelles portes il le compte.

La gamme livrée au lot précédent ne s'appliquait qu'à **une** porte sur trois :
`core/decision.py`, c'est-à-dire `/v1/authorize`, la voie *coopérative* — celle
qu'un agent peut ne jamais emprunter. Or le déploiement que le produit
recommande fait parler MCP à l'agent et rien d'autre.

Trois conséquences, et aucune ne casse quoi que ce soit — c'est bien le
problème. `decisions` comptait ~0 pour un client normal, donc la facturation à
l'usage mesurait le vide. Le juge, vendu à partir de `pro`, tournait par MCP
pour tous les paliers. Et le plafond du palier, dont tout l'invariant est de
**resserrer** un verdict, ne resserrait rien sur la seule porte qui exécute.

Deux métriques publiques étaient dans le même état, ailleurs : `proxy_calls` et
`export_jobs` sont plafonnées dans les trois paliers par `0030`, affichées au
client, et n'étaient comptées nulle part.

Les contrôles ci-dessous portent sur le **compteur** et sur ce que l'aval a reçu,
jamais sur le message rendu à l'appelant : un plafond qui refuse après avoir
relayé compte juste et protège rien.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from api import llm_proxy
from api.security import TokenVerifier
from core import entitlements
from core.entitlements import Metric
from core.judge import Judge
from core.policy import parse_policy
from gateway.server import ApprovalContext, PolicyBackend
from tests.conftest import DBHandle
from tests.test_llm_proxy import _client, _FakeClient, _FakeResp
from tests.test_preuve_avant_action import FakeProxy, _texte

#: Un `read` passe, un `delete` est irréversible et tenu. De quoi distinguer la
#: classe que le plafond doit fermer de celle qu'il doit laisser tourner.
POLICY = """tools: []
defaults:
  unknown_tool: deny
  auto_classify: true
  class_approvals:
    read: auto
    write: auto
    external_send: auto
    irreversible: auto
"""

UNE_COMPLETION: dict[str, Any] = {
    "id": "chatcmpl-quota",
    "object": "chat.completion",
    "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}}],
}


def _tenant(db: DBHandle, plan: str = "entreprise") -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name, plan) values (%s, 'M', %s)", (tid, plan))
    db.conn.commit()
    return tid


def _plafonner(db: DBHandle, plan: str, metric: Metric, valeur: int) -> None:
    """Poser un plafond atteignable sur un palier. `grace_pct` à zéro : on veut
    la frontière exacte, pas la tolérance."""
    db.conn.execute(
        "update plan_limits set limit_value = %s, grace_pct = 0 where plan = %s and metric = %s",
        (valeur, plan, metric.value),
    )
    db.conn.commit()


def _compteur(db: DBHandle, tenant_id: str, metric: Metric) -> int:
    with psycopg.connect(db.url) as check:
        row = check.execute(
            "select used from plan_usage_counters "
            "where tenant_id = %s and metric = %s and period_start = %s",
            (tenant_id, metric.value, entitlements.periode()),
        ).fetchone()
    return int(row[0]) if row else 0


def _lignes(db: DBHandle, tenant_id: str) -> list[str]:
    with psycopg.connect(db.url) as check:
        rows = check.execute(
            "select decision from audit_log where tenant_id = %s order by ts, id",
            (tenant_id,),
        ).fetchall()
    return [str(r[0]) for r in rows]


def _backend(proxy: FakeProxy, *, tenant_id: str, url: str) -> PolicyBackend:
    ctx = ApprovalContext(
        database_url=url, tenant_id=tenant_id, timeout_seconds=3600, gateway_token_id=None
    )
    return PolicyBackend(parse_policy(POLICY), proxy, ctx)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# La porte obligatoire
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_a_call_through_the_mandatory_door_is_billed(db: DBHandle) -> None:
    """Le compteur bouge sur la porte MCP. C'est tout le lot en une ligne."""
    tenant = _tenant(db)
    proxy = FakeProxy()
    backend = _backend(proxy, tenant_id=tenant, url=db.url)

    await backend.call_tool("read_doc", {})

    assert proxy.calls == ["read_doc"]
    assert _compteur(db, tenant, Metric.decisions) == 1


@pytest.mark.anyio
async def test_a_pre_policy_refusal_is_not_billed(db: DBHandle) -> None:
    """RBAC rend son verdict avant le moteur de policy : rien à facturer.

    La ligne d'audit, elle, s'écrit — c'est le correctif du lot 2. Le contrôle
    tient donc les deux moitiés : la preuve existe, la facture non.
    """
    tenant = _tenant(db)
    proxy = FakeProxy()
    yaml = POLICY.replace(
        "tools: []",
        "tools:\n"
        "  - name: mock.read_doc\n"
        "    class: read\n"
        "    approval: auto\n"
        "    constraints:\n"
        '      allowed_clients: ["autre"]',
    )

    ctx = ApprovalContext(
        database_url=db.url,
        tenant_id=tenant,
        timeout_seconds=3600,
        gateway_token_id=None,
        client_id="celui-ci",
    )
    backend = PolicyBackend(parse_policy(yaml), proxy, ctx)  # type: ignore[arg-type]

    await backend.call_tool("read_doc", {})

    assert proxy.calls == []
    assert _lignes(db, tenant) == ["rbac_denied"]
    assert _compteur(db, tenant, Metric.decisions) == 0


@pytest.mark.anyio
async def test_the_counter_reconciles_with_the_journal(db: DBHandle) -> None:
    """Une facture qu'on ne peut pas recompter depuis la preuve n'est pas défendable.

    Deux décisions de policy, un refus de garde. Le journal en garde trois, le
    compteur en compte deux — et c'est la propriété qu'on veut pouvoir opposer au
    client qui conteste sa facture : chaque unité facturée est une ligne signée.
    """

    tenant = _tenant(db)
    proxy = FakeProxy()
    await _backend(proxy, tenant_id=tenant, url=db.url).call_tool("read_doc", {})
    await _backend(proxy, tenant_id=tenant, url=db.url).call_tool("delete_everything", {})

    # Et un refus rendu **avant** le moteur de policy, sur le même tenant.
    ferme = ApprovalContext(
        database_url=db.url,
        tenant_id=tenant,
        timeout_seconds=3600,
        gateway_token_id=None,
        client_id="celui-ci",
    )
    yaml = POLICY.replace(
        "tools: []",
        "tools:\n"
        "  - name: mock.read_doc\n"
        "    class: read\n"
        "    approval: auto\n"
        "    constraints:\n"
        '      allowed_clients: ["autre"]',
    )
    await PolicyBackend(parse_policy(yaml), FakeProxy(), ferme).call_tool("read_doc", {})  # type: ignore[arg-type]

    assert _lignes(db, tenant) == ["allow", "allow", "rbac_denied"]
    assert _compteur(db, tenant, Metric.decisions) == 2


@pytest.mark.anyio
async def test_an_exhausted_plan_hardens_the_mandatory_door(db: DBHandle) -> None:
    """Le plafond resserre là où ça compte : sur la porte qui exécute.

    Le témoin est dans le même test. Sans plafond, l'irréversible part — c'est ce
    que la policy dit. Avec le plafond, il ne part pas. Écrit sans le témoin, ce
    contrôle passerait aussi bien sur un `call_tool` cassé.
    """
    tenant = _tenant(db, plan="pro")
    temoin = FakeProxy()
    await _backend(temoin, tenant_id=tenant, url=db.url).call_tool("delete_everything", {})
    assert temoin.calls == ["delete_everything"], "sans plafond, la policy relaie"

    _plafonner(db, "pro", Metric.decisions, 1)
    proxy = FakeProxy()
    result = await _backend(proxy, tenant_id=tenant, url=db.url).call_tool("delete_everything", {})

    assert proxy.calls == []
    assert "not permitted" in _texte(result) or "requires approval" in _texte(result)


@pytest.mark.anyio
async def test_a_light_class_keeps_running_at_the_cap(db: DBHandle) -> None:
    """Un tenant à sec ne perd pas la lecture. `tighten` ne touche pas les classes légères."""
    tenant = _tenant(db, plan="pro")
    _plafonner(db, "pro", Metric.decisions, 0)
    proxy = FakeProxy()

    await _backend(proxy, tenant_id=tenant, url=db.url).call_tool("read_doc", {})

    assert proxy.calls == ["read_doc"]


@pytest.mark.anyio
async def test_an_unreadable_entitlement_is_a_verdict_not_an_exception(db: DBHandle) -> None:
    """Une base absente sur la porte obligatoire rend un refus, jamais une exception.

    Le client MCP à l'autre bout n'a pas de branche pour une exception de
    transport : elle se lit comme une panne du gateway, et un agent coopératif
    privé de verdict refuse tout.
    """
    proxy = FakeProxy()
    backend = _backend(proxy, tenant_id=str(uuid4()), url="postgresql://postgres@127.0.0.1:1/none")

    result = await backend.call_tool("delete_everything", {})

    assert proxy.calls == []
    # Un verdict rendu à l'agent, et non une exception qui remonte au transport
    # MCP : le client à l'autre bout n'a pas de branche pour celle-là.
    assert "audit unavailable" in _texte(result)


# ---------------------------------------------------------------------------
# Le proxy LLM
# ---------------------------------------------------------------------------


def _jeton_passerelle(client: TestClient, admin: str) -> str:
    reponse = client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "bot"}
    )
    assert reponse.status_code == 201, reponse.text
    return str(reponse.json()["token"])


def _appel_proxy(client: TestClient, raw: str, fake: _FakeClient) -> Any:
    return client.post(
        "/proxy/openai/v1/chat/completions",
        headers={"X-Gateway-Token": raw, "Authorization": "Bearer sk-agent"},
        json={"model": "gpt-4o", "messages": [{"role": "user", "content": "salut"}]},
    )


def test_a_proxied_call_is_billed(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tenant, role="admin")
    raw = _jeton_passerelle(client, admin)
    fake = _FakeClient(_FakeResp(UNE_COMPLETION))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)

    assert _appel_proxy(client, raw, fake).status_code == 200
    assert _compteur(db, tenant, Metric.proxy_calls) == 1


def test_an_exhausted_proxy_quota_refuses_before_the_provider_is_paid(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Refusé **avant** l'appel au fournisseur, et le refus n'est pas facturé.

    Les deux moitiés comptent. Refuser après avoir payé le fournisseur ferait du
    plafond une ligne de journal ; compter le refus ferait grossir une facture
    pendant qu'on rend 409, et `plan_usage_counters` n'a pas de crédit.
    """
    tenant = _tenant(db, plan="pro")
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tenant, role="admin")
    raw = _jeton_passerelle(client, admin)
    _plafonner(db, "pro", Metric.proxy_calls, 1)
    fake = _FakeClient(_FakeResp(UNE_COMPLETION))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)

    assert _appel_proxy(client, raw, fake).status_code == 200
    assert _appel_proxy(client, raw, fake).status_code == 409

    assert _compteur(db, tenant, Metric.proxy_calls) == 1
    assert fake.captured["content"], "le premier appel est bien parti"


# ---------------------------------------------------------------------------
# Le dossier de conformité
# ---------------------------------------------------------------------------


def test_an_evidence_export_is_billed_and_capped(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    tenant = _tenant(db, plan="pro")
    client = _client(db.url, test_verifier)
    jeton = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    _plafonner(db, "pro", Metric.export_jobs, 1)

    assert client.get("/v1/compliance/export", headers=jeton).status_code == 200
    assert _compteur(db, tenant, Metric.export_jobs) == 1

    assert client.get("/v1/compliance/export", headers=jeton).status_code == 409
    assert _compteur(db, tenant, Metric.export_jobs) == 1, "un export refusé ne se facture pas"


@pytest.mark.anyio
async def test_a_plan_without_the_judge_does_not_get_it_on_the_mandatory_door(
    db: DBHandle,
) -> None:
    """Le juge est vendu à partir de `pro`, et il tournait ici pour tout le monde.

    La porte MCP passait `self._judge` sans jamais regarder le palier. Un tenant
    `free` obtenait donc par MCP l'enrichissement qu'il n'a pas acheté — et le
    correctif **durcit** : sans juge, un outil ambigu est plancherisé à
    `irreversible` (`AD-34`), donc tenu.

    Le témoin est le même tenant avec la capacité rendue : sans lui, ce contrôle
    passerait aussi bien sur un `resolve_ambiguous` qui ne tourne jamais.
    """
    yaml = (
        "tools:\n  - {name: mock.shell_exec, classify: ambiguous, approval: auto}\n"
        "defaults: {unknown_tool: deny}\n"
    )
    juge = Judge(lambda _s, _u: '{"action_class": "read"}')

    tenant = _tenant(db, plan="pro")
    db.conn.execute("delete from plan_capabilities where plan = 'pro' and capability = 'judge'")
    db.conn.commit()
    assert entitlements.load_entitlement(db.conn, tenant).limite(Metric.judge_calls), (
        "le budget doit rester, sinon c'est le compteur qu'on éprouve et pas la capacité"
    )

    sans = FakeProxy()
    ctx = ApprovalContext(
        database_url=db.url, tenant_id=tenant, timeout_seconds=3600, gateway_token_id=None
    )
    backend = PolicyBackend(parse_policy(yaml), sans, ctx, judge=juge)  # type: ignore[arg-type]
    await backend.call_tool("shell_exec", {"cmd": "ls"})
    assert sans.calls == [], "sans la capacité, l'ambigu est plancherisé et tenu"

    db.conn.execute("insert into plan_capabilities values ('pro', 'judge')")
    db.conn.commit()
    avec = FakeProxy()
    temoin = PolicyBackend(parse_policy(yaml), avec, ctx, judge=juge)  # type: ignore[arg-type]
    await temoin.call_tool("shell_exec", {"cmd": "ls"})
    assert avec.calls == ["shell_exec"], "avec la capacité, le juge classe et l'appel part"


def test_an_unreadable_quota_refuses_rather_than_relaying_unmetered(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Compteur illisible : on refuse, on ne relaie pas en silence.

    C'est la direction d'échec qui coûte le plus cher à choisir, alors autant
    l'écrire. Relayer sans compter est exactement le défaut que ce lot corrige, et
    il est **invisible** — personne n'ouvre un ticket parce que sa facture est trop
    basse. Un 503 est bruyant, réessayable, et se voit dans les métriques du jour
    même. C'est aussi la direction que `requires()` a déjà choisie pour la console
    (`api/entitlement_guard.py`) : le magasin de droits indisponible rend 503,
    jamais « autorisé par défaut ».
    """
    tenant = _tenant(db)
    client = _client(db.url, test_verifier)
    raw = _jeton_passerelle(client, make_token(tenant_id=tenant, role="admin"))
    fake = _FakeClient(_FakeResp(UNE_COMPLETION))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)

    def _tombe(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("quota store down")

    monkeypatch.setattr(llm_proxy.entitlements, "flux_allows", _tombe)

    assert _appel_proxy(client, raw, fake).status_code == 503
    assert fake.captured == {}, "le fournisseur ne doit pas avoir été appelé"
