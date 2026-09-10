"""La gamme sur le chemin chaud : compteurs, resserrement, et ce qu'elle ne touche pas.

Un plafond commercial branché sur le chemin de décision est la chose la plus facile
à rendre dangereuse dans ce produit : il suffit qu'il puisse **relâcher** un verdict
pour que la facturation devienne un moteur de policy. L'invariant est donc énoncé ici
sur une table exhaustive plutôt que sur les cas auxquels on a pensé — un contrôle
cas-par-cas laisse passer la combinaison qu'on n'a pas écrite, et c'est toujours
celle-là.

Et le plafond ne passe jamais devant un humain (§4.1). Le geste le plus lourd du
produit — un opérateur qui débloque une action irréversible — ne peut pas être annulé
par un compteur.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import approvals, audit, decision, entitlements
from core.config import Settings
from core.entitlements import Capability, Meter, Metric
from core.judge import Judge
from core.policy import ActionClass, Approval, PolicyOutcome, parse_policy
from tests.conftest import DBHandle

_ORIGIN = audit.Origin.authorize_api()

_POLICY = parse_policy(
    """
tools:
  - {name: crm.read, class: read, approval: auto}
  - {name: crm.edit, class: write, approval: auto}
  - {name: crm.wipe, class: irreversible, approval: human_in_the_loop}
  - {name: crm.mail, class: external_send, approval: notify}
defaults: {unknown_tool: deny, on_approval_service_down: deny}
"""
)

#: L'ordre de sévérité, écrit une fois. Il doit être celui de `core.policy.raise_to` —
#: `test_the_severity_order_matches_the_products` le confronte plutôt que de le croire.
_SEVERITE = {
    Approval.auto: 0,
    Approval.notify: 1,
    Approval.human_in_the_loop: 2,
    Approval.human_dual: 3,
    Approval.deny: 4,
}


def _tenant(db: DBHandle, plan: str = "pro") -> str:
    tid = uuid4()
    db.conn.execute("insert into tenants (id, name, plan) values (%s, 'A', %s)", (tid, plan))
    db.conn.commit()
    return str(tid)


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def _saturer(db: DBHandle, tenant_id: str, metric: Metric, valeur: int) -> None:
    db.conn.execute(
        "insert into plan_usage_counters (tenant_id, metric, period_start, used) "
        "values (%s, %s, %s, %s) "
        "on conflict (tenant_id, metric, period_start) do update set used = excluded.used",
        (tenant_id, metric.value, entitlements.periode(), valeur),
    )
    db.conn.commit()


# ---------------------------------------------------------------------------
# 1. L'invariant, sur une table exhaustive
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("verdict", list(Approval))
@pytest.mark.parametrize("etat", list(Meter))
def test_a_quota_can_only_tighten_a_verdict_never_relax_it(
    db: DBHandle, verdict: Approval, etat: Meter
) -> None:
    """Vingt combinaisons, et aucune ne doit descendre. C'est l'invariant central.

    Une inversion accidentelle dans `tighten` ferait de la facturation un moteur de
    policy : un `deny` de règle transformé en `auto` par un état de compteur. Écrit
    cas par cas, ce contrôle laisserait passer la combinaison non prévue ; écrit en
    table, il n'en laisse aucune.
    """
    droit = entitlements.load_entitlement(db.conn, _tenant(db))
    avant = PolicyOutcome(None, verdict, "regle", "policy rule")

    apres = entitlements.tighten(avant, _POLICY, reason=etat)

    assert _SEVERITE[apres.decision] >= _SEVERITE[avant.decision], (
        f"{etat.value} a RELÂCHÉ {verdict.value} en {apres.decision.value} — "
        "la facturation vient de devenir un moteur de policy"
    )
    assert droit.plan == "pro"  # non-vacuité : le droit est bien lisible


def test_the_severity_order_matches_the_products(db: DBHandle) -> None:
    """La table ci-dessus doit être celle du produit, pas une seconde opinion.

    `core.policy.raise_to` porte l'ordre de sévérité de tout le dépôt. Si les deux
    divergeaient, le contrôle d'invariant serait vrai contre son propre barème et
    faux contre celui qui décide.
    """
    from core.policy import raise_to

    for bas, haut in ((a, b) for a in Approval for b in Approval):
        attendu = haut if _SEVERITE[haut] > _SEVERITE[bas] else bas
        assert raise_to(bas, haut) is attendu, f"{bas.value} + {haut.value}"


def test_an_unreadable_counter_tightens_exactly_like_an_exhausted_one(db: DBHandle) -> None:
    """`unknown` resserre comme `capped`, et c'est le défaut que ce test grave.

    Le traiter comme `grace` s'appuierait sur `AD-34`, qui ne couvre que
    `classify: ambiguous` : une règle `approval: auto` sur un `write` **non ambigu**
    continuerait de passer sans aucun plafond. Un hoquet Postgres redeviendrait
    « plus aucune limite, sur tout ce qui n'est pas ambigu ».
    """
    avant = PolicyOutcome(entitlements.Capability and None, Approval.auto, "regle", "policy rule")
    ecrit = PolicyOutcome(None, Approval.auto, "regle", "policy rule")
    assert avant == ecrit  # garde-fou d'écriture du test lui-même

    capped = entitlements.tighten(ecrit, _POLICY, reason=Meter.capped)
    unknown = entitlements.tighten(ecrit, _POLICY, reason=Meter.unknown)

    assert capped.decision is unknown.decision is Approval.deny
    assert capped.reason == "plan_capped"
    assert unknown.reason == "plan_unknown"


def test_a_light_class_keeps_running_at_the_cap(db: DBHandle) -> None:
    """Le plafond ferme les classes dangereuses et laisse les légères continuer.

    C'est le **même** découpage que `service_down_verdict`, délibérément : quota
    épuisé et service d'approbation en panne disent la même chose à l'agent — nous ne
    pouvons plus garantir ce que nous garantissons d'habitude. Un plafond qui
    arrêterait aussi les lectures transformerait un incident de paiement en incident
    de production.
    """
    lecture = PolicyOutcome(ActionClass.read, Approval.auto, "regle", "policy rule")
    assert entitlements.tighten(lecture, _POLICY, reason=Meter.capped).decision is Approval.auto


# ---------------------------------------------------------------------------
# 2. Ce que le plafond ne touche jamais : l'humain
# ---------------------------------------------------------------------------


def test_an_approval_a_human_already_granted_survives_the_absolute_cap(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """§4.1 : la comptabilité ne peut pas annuler le clic d'un opérateur.

    Le tenant est **très** au-dessus de son plafond de décisions. Un humain a déjà
    approuvé l'action irréversible. Sans l'exemption, le ré-appel de l'agent verrait
    son `human_in_the_loop` resserré en `deny` avant même de regarder l'approbation :
    l'action approuvée n'aurait jamais lieu, et personne ne saurait pourquoi.
    """
    tenant = _tenant(db)
    _saturer(db, tenant, Metric.decisions, 10_000_000)
    client = _client(db.url, test_verifier)
    entetes = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    client.put("/v1/policy", headers=entetes, json={"yaml": _POLICY_YAML})

    tenu = decision.authorize(
        database_url=db.url,
        policy=_POLICY,
        tenant_id=tenant,
        tool="crm.wipe",
        arguments={"id": "1"},
    )
    assert tenu["decision"] == "hold", tenu

    approvals.decide(db.conn, tenant, tenu["approval_id"], "approve", "op-1")

    rendu = decision.authorize(
        database_url=db.url,
        policy=_POLICY,
        tenant_id=tenant,
        tool="crm.wipe",
        arguments={"id": "1"},
    )
    assert rendu["decision"] == "allow", (
        f"un humain avait approuvé, et le plafond a rendu {rendu} — §4.1 percée par la comptabilité"
    )


_POLICY_YAML = """
tools:
  - {name: crm.wipe, class: irreversible, approval: human_in_the_loop}
defaults: {unknown_tool: deny}
"""


def test_a_capped_tenant_gets_a_verdict_not_an_http_error(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Le vrai fail-open du dossier : une erreur HTTP fait **deviner** l'agent.

    Et il devine dans le sens qui l'arrange. C'est la correction déjà faite dans ce
    module quand le service d'approbation tombait ; le plafond de plan devait hériter
    de la même règle, pas d'un 402 ni d'un 429 sur `/v1/authorize`.
    """
    tenant = _tenant(db)
    _saturer(db, tenant, Metric.decisions, 10_000_000)
    client = _client(db.url, test_verifier)
    entetes = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}
    assert (
        client.put(
            "/v1/policy",
            headers=entetes,
            json={"yaml": "tools:\n  - {name: crm.mail, class: external_send, approval: auto}\n"},
        ).status_code
        == 200
    )

    raw = client.post("/v1/gateway-tokens", headers=entetes, json={"name": "bot"}).json()["token"]
    reponse = client.post(
        "/v1/authorize",
        headers={"X-Gateway-Token": raw},
        json={"tool": "crm.mail", "arguments": {"to": "a@b.fr"}},
    )

    assert reponse.status_code == 200, reponse.text
    corps = reponse.json()
    assert corps["decision"] == "deny"
    assert corps["reason"] == "plan_capped"


# ---------------------------------------------------------------------------
# 3. Le compteur ne peut pas faire perdre une preuve
# ---------------------------------------------------------------------------


def test_a_failing_counter_never_loses_the_audit_row(
    db: DBHandle, monkeypatch: pytest.MonkeyPatch
) -> None:
    """La condition d'acceptation de toute la greffe.

    Le compteur est débité **dans** la transaction qui écrit la preuve, sous le verrou
    consultatif que `log_event` tient déjà — pas de verrou de plus, donc pas de classe
    d'interblocage de plus. Le prix de ce choix est qu'une erreur de facturation
    pourrait empoisonner la transaction et faire perdre la ligne d'audit, ce que §4.2
    interdit. D'où le point de sauvegarde interne, et d'où ce test.

    C'est aussi la raison pour laquelle `plan_usage_counters` ne porte **aucun
    trigger** : un trigger qui lève ferait avorter la transaction sans qu'aucun point
    de sauvegarde ne le rattrape.
    """
    tenant = _tenant(db)

    def boum(*_a: object, **_k: object) -> object:
        raise RuntimeError("counter store unreachable")

    monkeypatch.setattr(entitlements, "consume", boum)

    audit.log_event(
        db.conn,
        tenant_id=tenant,
        decision="allow",
        action_class="read",
        origin=_ORIGIN,
        usage_metric=Metric.decisions.value,
    )
    db.conn.commit()

    lignes = db.conn.execute(
        "select decision from audit_log where tenant_id = %s", (tenant,)
    ).fetchall()
    assert [r[0] for r in lignes] == ["allow"], "la preuve a été perdue par la facturation"
    assert audit.verify_chain(db.conn, tenant).ok is True


def test_a_successful_debit_moves_the_counter(db: DBHandle) -> None:
    """Non-vacuité du précédent : un débit qui ne débite jamais le ferait passer."""
    tenant = _tenant(db)

    for _ in range(3):
        audit.log_event(
            db.conn,
            tenant_id=tenant,
            decision="allow",
            action_class="read",
            origin=_ORIGIN,
            usage_metric=Metric.decisions.value,
        )
    db.conn.commit()

    assert entitlements.lire_compteur(db.conn, tenant, Metric.decisions) == 3


def test_a_refusal_is_not_billed_as_a_decision(db: DBHandle) -> None:
    """Un refus ne consomme pas de quota, et c'est un choix commercial explicite.

    Facturer ce qu'on a empêché reviendrait à faire payer le client pour la sécurité
    qu'il achète — et lui donnerait une raison de désactiver la garde.
    """
    tenant = _tenant(db)
    audit.log_event(
        db.conn, tenant_id=tenant, decision="deny", action_class="irreversible", origin=_ORIGIN
    )
    db.conn.commit()

    assert entitlements.lire_compteur(db.conn, tenant, Metric.decisions) == 0


# ---------------------------------------------------------------------------
# 4. Le juge, enrichissement payant dont l'absence durcit
# ---------------------------------------------------------------------------


def test_a_plan_without_the_judge_hardens_rather_than_relaxes(db: DBHandle) -> None:
    """Couper un enrichissement payant doit **fermer**, jamais ouvrir.

    C'est ce qui permet de vendre le juge sans rouvrir le moteur de policy : sans
    lui, `resolve_ambiguous` plancherise à `irreversible` (`AD-34`), donc l'outil
    ambigu part en approbation humaine au lieu de passer. Un palier `free` est donc
    plus **strict**, pas plus laxiste — l'inverse de ce que l'intuition commerciale
    suggère, et la seule forme défendable.
    """
    tenant = _tenant(db, "free")
    droit = entitlements.load_entitlement(db.conn, tenant)
    assert not droit.allows(Capability.judge)

    policy = parse_policy(
        "tools:\n  - {name: shell.exec, classify: ambiguous, approval: auto}\n"
        "defaults: {unknown_tool: deny}\n"
    )
    rendu = decision.authorize(
        database_url=db.url,
        policy=policy,
        tenant_id=tenant,
        tool="shell.exec",
        arguments={"cmd": "rm -rf /"},
    )

    assert rendu["decision"] == "hold"
    assert rendu["action_class"] == "irreversible"


def test_an_exhausted_judge_budget_hardens_the_same_way(db: DBHandle) -> None:
    """Et le plafond d'appels au juge se comporte comme son absence, pas comme sa présence."""
    tenant = _tenant(db, "pro")
    _saturer(db, tenant, Metric.judge_calls, 1_000_000)

    policy = parse_policy(
        "tools:\n  - {name: shell.exec, classify: ambiguous, approval: auto}\n"
        "defaults: {unknown_tool: deny}\n"
    )
    rendu = decision.authorize(
        database_url=db.url,
        policy=policy,
        tenant_id=tenant,
        tool="shell.exec",
        arguments={"cmd": "ls"},
        judge=Judge(lambda _s, _u: '{"action_class": "read"}'),
    )

    assert rendu["decision"] == "hold", "un budget épuisé doit fermer, comme un juge absent"
    assert rendu["action_class"] == "irreversible"
