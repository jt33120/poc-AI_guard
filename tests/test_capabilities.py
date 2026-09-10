"""Ce que le palier verrouille, et ce qu'il ne peut pas verrouiller.

Trente-sept capacités publiées par `capability_catalog`, **quatorze** nommées par le
produit. Quatre des vingt-trois restantes sont `PLANCHER` — jamais verrouillées par
construction, §4.1 et §4.2 ne se vendent pas. Les **dix-neuf autres étaient vendues
par palier et vérifiées nulle part** : tous les paliers les recevaient, y compris
ceux qui ne les avaient pas achetées.

Le défaut ne casse rien, et c'est ce qui le rend introuvable après coup — le code
fait ce qu'il a toujours fait, aucun test n'échoue, et le client `free` reçoit ce que
le client `pro` paie.

**Une règle gouverne tout le fichier.** Un palier peut retirer une fonctionnalité ;
il ne peut jamais relâcher un verdict. Chaque contrôle ci-dessous vérifie donc les
deux moitiés : la fonctionnalité disparaît sans la capacité, et ce qui disparaît
n'ouvre rien.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from api import audit as audit_routes
from api import llm_proxy
from api.main import create_app
from api.security import TokenVerifier
from core import monitor
from core.config import Settings
from core.entitlements import Capability
from core.policy import parse_policy
from tests.conftest import DBHandle
from tests.test_llm_proxy import _FakeClient, _FakeResp

AWS_KEY = "AKIAIOSFODNN7EXAMPLE"  # faux, bien formé

UNE_COMPLETION: dict[str, Any] = {
    "id": "chatcmpl-cap",
    "object": "chat.completion",
    "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}}],
}

#: Une policy qui allume la contamination de session — vendue à partir de `pro`.
POLICY_TEINTE = """tools: []
defaults:
  unknown_tool: deny
  taint_policy: escalate
"""

POLICY_SIMPLE = """tools: []
defaults:
  unknown_tool: deny
"""

#: Une policy qui **retient** une écriture : sans cela une fenêtre d'observation
#: n'aurait rien à relâcher, et le contrôle ne dirait rien.
POLICY_ECRITURE = """tools: []
defaults:
  unknown_tool: deny
  auto_classify: true
  class_approvals:
    read: auto
    write: human_in_the_loop
    external_send: human_in_the_loop
    irreversible: human_in_the_loop
"""

UNE_ECRITURE: dict[str, Any] = {
    "id": "chatcmpl-window",
    "object": "chat.completion",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "call_w",
                        "type": "function",
                        "function": {"name": "crm.update_contact", "arguments": "{}"},
                    }
                ],
            },
        }
    ],
}


def _client(db_url: str, verifier: TokenVerifier, **kw: Any) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url, **kw))
    app.state.verifier = verifier
    return TestClient(app)


def _tenant(db: DBHandle, plan: str = "entreprise") -> str:
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name, plan) values (%s, 'C', %s)", (tid, plan))
    db.conn.commit()
    return tid


def _retirer(db: DBHandle, plan: str, capacite: Capability) -> None:
    db.conn.execute(
        "delete from plan_capabilities where plan = %s and capability = %s",
        (plan, capacite.value),
    )
    db.conn.commit()


def _enregistrer(client: TestClient, entetes: dict[str, str], yaml: str) -> int:
    return client.put("/v1/policy", headers=entetes, json={"yaml": yaml}).status_code


def _mint(client: TestClient, admin: str) -> str:
    reponse = client.post(
        "/v1/gateway-tokens", headers={"Authorization": f"Bearer {admin}"}, json={"name": "bot"}
    )
    assert reponse.status_code == 201, reponse.text
    return str(reponse.json()["token"])


# ---------------------------------------------------------------------------
# Les champs de policy : le verrou est à l'enregistrement
# ---------------------------------------------------------------------------


def test_a_plan_without_the_feature_cannot_turn_it_on_in_its_own_policy(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Quatre fonctionnalités vendues s'allumaient en tapant une ligne de YAML.

    Le témoin est dans le même corps : le même document passe pour un palier qui a
    la capacité. Sans lui, ce contrôle passerait aussi bien sur un `PUT` cassé.
    """
    tenant = _tenant(db, plan="pro")
    client = _client(db.url, test_verifier)
    entetes = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}

    assert _enregistrer(client, entetes, POLICY_TEINTE) == 200

    _retirer(db, "pro", Capability.taint_guard)
    refus = client.put("/v1/policy", headers=entetes, json={"yaml": POLICY_TEINTE})
    assert refus.status_code == 402
    assert "taint_guard" in refus.json()["detail"]


def test_a_refused_policy_leaves_the_previous_one_in_place(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """La direction d'échec qui ne coûte pas une garde.

    Refuser l'enregistrement laisse tourner ce qui tournait. C'est le contraire du
    dessin naïf — vérifier à la décision — qui, lui, retirerait une garde en cours
    d'exécution pour une raison commerciale, et dans la session teintée précisément.
    """
    tenant = _tenant(db, plan="pro")
    client = _client(db.url, test_verifier)
    entetes = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    assert _enregistrer(client, entetes, POLICY_TEINTE) == 200

    _retirer(db, "pro", Capability.taint_guard)
    assert _enregistrer(client, entetes, POLICY_TEINTE) == 402

    garde = client.get("/v1/policy", headers=entetes).json()["yaml"]
    assert "taint_policy: escalate" in garde, "la policy enregistrée doit survivre au refus"


def test_a_policy_that_turns_nothing_on_is_still_accepted(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Sinon le verrou refuserait tout le monde, et le contrôle ci-dessus ne dirait rien."""
    tenant = _tenant(db, plan="free")
    client = _client(db.url, test_verifier)
    entetes = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    assert _enregistrer(client, entetes, POLICY_SIMPLE) == 200


# ---------------------------------------------------------------------------
# Les services : le verrou est au site qui les sert
# ---------------------------------------------------------------------------


def test_a_plan_without_the_proxy_cannot_use_it(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Le routeur du proxy ne porte aucun verrou — il n'authentifie pas par JWT.

    Le verrou vit donc là où le principal EST résolu. Et le refus arrive **avant**
    l'appel au fournisseur : refuser après l'avoir payé ferait du palier une ligne
    de journal.
    """
    tenant = _tenant(db, plan="pro")
    client = _client(db.url, test_verifier)
    raw = _mint(client, make_token(tenant_id=tenant, role="admin"))
    fake = _FakeClient(_FakeResp(UNE_COMPLETION))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    entetes = {"X-Gateway-Token": raw, "Authorization": "Bearer sk-agent"}
    corps = {"model": "gpt-4o", "messages": [{"role": "user", "content": "salut"}]}

    temoin = client.post("/proxy/openai/v1/chat/completions", headers=entetes, json=corps)
    assert temoin.status_code == 200

    _retirer(db, "pro", Capability.llm_proxy)
    fake.captured = {}
    refus = client.post("/proxy/openai/v1/chat/completions", headers=entetes, json=corps)
    assert refus.status_code == 402
    assert fake.captured == {}, "le fournisseur ne doit pas avoir été appelé"


def test_dlp_does_not_inspect_a_plan_that_did_not_buy_it(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`dlp_enabled` est l'interrupteur plateforme, la capacité l'interrupteur commercial.

    Il manquait : la DLP inspectait l'egress de tous les paliers. `dlp_config`
    verrouillait le **réglage fin** et laissait le service lui-même gratuit — la
    faute la plus facile à faire, parce que la table des routeurs a l'air complète.

    Les deux moitiés sont contrôlées : avec la capacité le secret est retenu, sans
    elle il part. La seconde est désagréable à écrire, et c'est exactement pourquoi
    elle doit l'être — c'est ce que le palier `free` achète.
    """
    tenant = _tenant(db, plan="pro")
    client = _client(db.url, test_verifier, dlp_enabled=True)
    raw = _mint(client, make_token(tenant_id=tenant, role="admin"))
    fake = _FakeClient(_FakeResp(UNE_COMPLETION))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    entetes = {"X-Gateway-Token": raw, "Authorization": "Bearer sk-agent"}
    corps = {"model": "gpt-4o", "messages": [{"role": "user", "content": f"clé {AWS_KEY}"}]}

    bloque = client.post("/proxy/openai/v1/chat/completions", headers=entetes, json=corps)
    assert bloque.status_code == 403 and fake.captured == {}

    _retirer(db, "pro", Capability.dlp)
    passe = client.post("/proxy/openai/v1/chat/completions", headers=entetes, json=corps)
    assert passe.status_code == 200, "sans la capacité, la DLP ne tourne pas"
    assert fake.captured != {}


# ---------------------------------------------------------------------------
# L'export d'audit : deux capacités, deux effets distincts
# ---------------------------------------------------------------------------


def test_the_raw_export_is_gated_and_its_narrative_is_gated_separately(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Deux verrous sur une route, et ils ne retirent pas la même chose.

    `audit_export_raw` retire l'export. `ai_summary` retire seulement le **récit**
    rédigé par modèle : les chiffres restent, donc la preuve reste. Un dossier de
    conformité amputé de ses chiffres pour une raison de facturation serait la faute
    que tout ce dépôt corrige ; amputé de sa prose, c'est un confort en moins.
    """
    tenant = _tenant(db, plan="pro")
    client = _client(db.url, test_verifier)
    entetes = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}

    complet = client.get("/v1/audit/export?format=ai_act", headers=entetes)
    assert complet.status_code == 200
    assert "events_total" in complet.json()

    _retirer(db, "pro", Capability.audit_export_raw)
    assert client.get("/v1/audit/export?format=ai_act", headers=entetes).status_code == 402


def test_the_assistant_is_not_included_in_every_plan(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """La rédaction de policy en langage naturel appelle un modèle : elle se vend.

    Elle vit dans le routeur de policy, qui est du **socle** — éditer sa policy ne
    se facture pas (§4.4). Le verrou est donc sur la route, pas sur le routeur, et
    c'est la forme qu'il faut chaque fois qu'un routeur gratuit porte une route
    payante.
    """
    tenant = _tenant(db, plan="free")
    client = _client(db.url, test_verifier)
    entetes = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}

    refus = client.post("/v1/policy/draft", headers=entetes, json={"prompt": "bloque les rm -rf"})
    assert refus.status_code == 402
    assert "policy_assistant" in refus.json()["detail"]


def test_the_model_written_narrative_is_gated_but_the_figures_never_are(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sans `ai_summary`, l'export garde ses chiffres et perd sa prose de modèle.

    `build_report` retombe sur `default_narrative`, qui est **déterministe**. Le
    dossier reste donc complet et vérifiable ; ce qui disparaît est la rédaction,
    et elle seule. C'est la seule forme acceptable d'un verrou commercial sur une
    route de conformité.
    """
    from core.judge import Judge

    tenant = _tenant(db, plan="pro")
    client = _client(db.url, test_verifier)
    entetes = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    monkeypatch.setattr(
        audit_routes, "build_judge", lambda _s: Judge(lambda _sys, _u: "RÉCIT DE MODÈLE")
    )

    avec = client.get("/v1/audit/export?format=ai_act", headers=entetes).json()
    assert avec["narrative"] == "RÉCIT DE MODÈLE"

    _retirer(db, "pro", Capability.ai_summary)
    sans = client.get("/v1/audit/export?format=ai_act", headers=entetes).json()
    assert sans["narrative"] != "RÉCIT DE MODÈLE"
    assert sans["events_total"] == avec["events_total"], "les chiffres ne se facturent pas"


def test_a_plan_without_windows_keeps_enforcing_on_the_proxy(
    db: DBHandle,
    test_verifier: TokenVerifier,
    make_token: Callable[..., str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """La fenêtre d'observation est vendue, et son absence **resserre**.

    C'est la seule direction dans laquelle un palier peut toucher ce garde. Le
    contraire — un palier qui ouvrirait une fenêtre — serait la facturation devenue
    moteur de policy, ce que toute la gamme existe pour interdire.

    Le témoin est dans le même corps : avec la capacité, la fenêtre relaie bien
    l'appel refusé. Sans lui, ce contrôle passerait sur une fenêtre jamais ouverte.
    """
    tenant = _tenant(db, plan="pro")
    client = _client(db.url, test_verifier)
    admin = make_token(tenant_id=tenant, role="admin")
    entetes_admin = {"Authorization": f"Bearer {admin}"}
    assert _enregistrer(client, entetes_admin, POLICY_ECRITURE) == 200
    raw = _mint(client, admin)
    jeton = db.conn.execute(
        "select id from gateway_tokens where tenant_id = %s", (tenant,)
    ).fetchone()
    assert jeton is not None
    monitor.open_window(
        db.conn,
        tenant_id=tenant,
        gateway_token_id=str(jeton[0]),
        hours=1,
        max_hours=24,
    )
    db.conn.commit()

    fake = _FakeClient(_FakeResp(UNE_ECRITURE))
    monkeypatch.setattr(llm_proxy, "_http", lambda: fake)
    entetes = {"X-Gateway-Token": raw, "Authorization": "Bearer sk-agent"}
    corps = {"model": "gpt-4o", "messages": [{"role": "user", "content": "modifie"}]}

    ouvert = client.post("/proxy/openai/v1/chat/completions", headers=entetes, json=corps).json()
    relayes = [c["function"]["name"] for c in ouvert["choices"][0]["message"].get("tool_calls", [])]
    assert relayes == ["crm.update_contact"], "avec la capacité, la fenêtre relaie"

    _retirer(db, "pro", Capability.monitor_windows)
    ferme = client.post("/proxy/openai/v1/chat/completions", headers=entetes, json=corps).json()
    restants = [c["function"]["name"] for c in ferme["choices"][0]["message"].get("tool_calls", [])]
    assert restants == [], "sans la capacité, il n'y a pas de fenêtre — donc on applique"


@pytest.mark.anyio
async def test_a_plan_without_notifications_still_holds_the_human(db: DBHandle) -> None:
    """`notify` retire le canal de prévenance, jamais la mise en attente.

    C'est la distinction qui rend cette capacité vendable : §4.1 exige qu'un humain
    tienne l'action irréversible, et il la tient — l'approbation est créée, elle
    attend dans la console. Ce que le palier `free` n'a pas, c'est le message qui
    prévient. Si le verrou avait porté sur la mise en attente elle-même, il aurait
    vendu la garantie et livré le risque.
    """
    from gateway.server import ApprovalContext, PolicyBackend
    from tests.test_preuve_avant_action import FakeProxy

    class _Compteur:
        def __init__(self) -> None:
            self.envois: list[str] = []

        def notify_approval(self, *, approval_id: str, summary: str, expires_at: str) -> None:
            self.envois.append(approval_id)

    yaml = (
        "tools:\n  - {name: mock.wire, class: irreversible, approval: human_in_the_loop}\n"
        "defaults: {unknown_tool: deny}\n"
    )

    async def _tenir(plan: str) -> tuple[_Compteur, int]:
        tenant = _tenant(db, plan=plan)
        notifieur = _Compteur()
        ctx = ApprovalContext(
            database_url=db.url,
            tenant_id=tenant,
            timeout_seconds=3600,
            gateway_token_id=None,
            notifier=notifieur,
        )
        proxy = FakeProxy()
        backend = PolicyBackend(parse_policy(yaml), proxy, ctx)  # type: ignore[arg-type]
        await backend.call_tool("wire", {"amount": 1})
        attentes = db.conn.execute(
            "select count(*) from approvals where tenant_id = %s", (tenant,)
        ).fetchone()
        assert proxy.calls == [], "l'irréversible ne part jamais, quel que soit le palier"
        return notifieur, int(attentes[0]) if attentes else 0

    avec, tenues_avec = await _tenir("pro")
    assert avec.envois and tenues_avec == 1

    _retirer(db, "pro", Capability.notify)
    sans, tenues_sans = await _tenir("pro")
    assert sans.envois == [], "sans la capacité, aucun message ne part"
    assert tenues_sans == 1, "et l'humain est tenu quand même — §4.1 n'est pas une option"
