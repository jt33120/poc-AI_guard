"""`/v1/ops/metrics` — ce que le produit sait dire de lui-même, et à qui.

Trois pannes n'avaient **aucune** représentation exploitable avant ce lot :

* une écriture d'audit ratée ne laissait qu'un `logger.warning` — c'est-à-dire la
  perte de la revendication centrale du produit (§4.2), sans rien qu'un exploitant
  puisse mettre sous alerte ;
* un juge qui expire sortait du journal en `judge_used=False`, indistinguable de
  « aucun juge n'a été sollicité » — deux états qui demandent des réactions opposées ;
* le volume de verdicts et le coût de la garde ne se lisaient qu'en agrégeant du SQL.

Le reste était vert pendant ce temps : la sonde répondait, la chaîne se vérifiait. Un
trou d'observabilité ne casse rien, il rend seulement aveugle.

**Deux contrôles de ce fichier valent les autres réunis** : que le relevé ne réponde
rien à un anonyme, et qu'il ne porte jamais d'identifiant de tenant. Le premier parce
qu'un relevé de trafic dit quel déploiement vaut la peine d'être attaqué ; le second
parce qu'une étiquette non bornée est à la fois une fuite commerciale et une fuite de
mémoire qu'un tiers choisit.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from api.main import Plane, create_app
from api.ops import CONTENT_TYPE
from core import audit
from core import db as core_db
from core.config import Settings
from core.metrics import _MAX_SERIES, Registre, registre
from tests.conftest import DBHandle

JETON = "s3cr3t-scrutateur"


@pytest.fixture(autouse=True)
def _registre_vierge() -> Iterator[None]:
    """Un registre de processus est un état global : chaque test part de zéro.

    Sans cela l'ordre des tests décide de leurs assertions, et le premier qui échoue
    est celui qu'on a ajouté en dernier — pas celui qui a cassé quelque chose.
    """
    registre.remise_a_zero()
    yield
    registre.remise_a_zero()


def _app(*, jeton: str | None = JETON, plane: Plane = Plane.ALL, url: str | None = None) -> Any:
    return create_app(
        Settings(_env_file=None, env="dev", database_url=url, ops_metrics_token=jeton),
        plane=plane,
    )


def _relever(client: TestClient, jeton: str | None = JETON) -> str:
    entetes = {"Authorization": f"Bearer {jeton}"} if jeton else {}
    reponse = client.get("/v1/ops/metrics", headers=entetes)
    assert reponse.status_code == 200, reponse.text
    return reponse.text


# ---------------------------------------------------------------------------
# La porte
# ---------------------------------------------------------------------------
def test_an_unconfigured_deployment_serves_nothing_at_all() -> None:
    """Sans jeton configuré, la route **n'existe pas**. 404, jamais 403.

    Répondre « il y a bien un point de métriques ici, mais il vous faut un jeton »
    est déjà une information de plus que zéro, et un scrutateur légitime a le jeton.
    C'est la même ligne que celle que `api/health.py` tient pour la sonde (`INV-11`).
    """
    client = TestClient(_app(jeton=None))
    assert client.get("/v1/ops/metrics").status_code == 404


def test_a_wrong_token_is_indistinguishable_from_an_absent_endpoint() -> None:
    """Un jeton faux obtient exactement la même réponse qu'un déploiement sans jeton.

    Sinon la différence entre 401 et 404 devient un oracle : elle dit à l'attaquant
    que ce déploiement-ci publie ses métriques, donc qu'il vaut la peine d'insister.
    """
    client = TestClient(_app())
    for entete in ({}, {"Authorization": "Bearer faux"}, {"Authorization": JETON}):
        assert client.get("/v1/ops/metrics", headers=entete).status_code == 404


def test_the_scrape_is_served_in_the_format_prometheus_expects() -> None:
    client = TestClient(_app())
    reponse = client.get("/v1/ops/metrics", headers={"Authorization": f"Bearer {JETON}"})
    assert reponse.status_code == 200
    assert reponse.headers["content-type"].startswith(CONTENT_TYPE.split(";")[0])


@pytest.mark.parametrize("plane", list(Plane))
def test_every_plane_serves_its_own_scrape(plane: Plane) -> None:
    """Les compteurs vivent dans le **processus** qui répond.

    Monté sur la seule console, le relevé ne dirait rien du plan décision ni du proxy
    — c'est-à-dire rien des deux chemins chauds, ceux dont on veut précisément voir le
    volume et la latence.
    """
    client = TestClient(_app(plane=plane))
    reponse = client.get("/v1/ops/metrics", headers={"Authorization": f"Bearer {JETON}"})
    assert reponse.status_code == 200


# ---------------------------------------------------------------------------
# Ce que le relevé dit
# ---------------------------------------------------------------------------
def test_a_written_decision_shows_up_by_verdict_and_by_door(db: DBHandle) -> None:
    """L'instrumentation vit dans `log_event`, le seul point où les trois portes convergent.

    C'est ce qui rend la mesure complète **par construction** : un verdict calculé ou
    lu en base, qu'aucun balayage du code ne retrouverait, y passe quand même.
    """
    tenant = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'O')", (tenant,))
    db.conn.commit()
    with core_db.connection(db.url) as conn:
        audit.log_event(
            conn,
            tenant_id=tenant,
            decision="allow",
            origin=audit.Origin.mcp_gateway(),
            decision_ms=7,
        )
        audit.log_event(
            conn, tenant_id=tenant, decision="deny", origin=audit.Origin.authorize_api()
        )
        conn.commit()

    releve = _relever(TestClient(_app(url=db.url)))
    assert 'xsom_decisions_total{decision="allow",enforcement_mode="enforcing",' in releve
    assert 'ingress="mcp_gateway"} 1' in releve
    assert 'ingress="authorize_api"} 1' in releve
    # L'histogramme du coût de garde, alimenté par la même ligne.
    assert "xsom_decision_ms_bucket" in releve
    assert 'xsom_decision_ms_count{ingress="mcp_gateway"} 1' in releve


def test_the_scrape_never_names_a_tenant_an_agent_or_a_tool(db: DBHandle) -> None:
    """**Le contrôle de divulgation.** Aucune étiquette ne porte d'identité.

    Deux raisons, et la seconde suffirait : un relevé qui nomme les tenants publie le
    nombre de clients et leur volume à qui atteint la route, et une étiquette non
    bornée est une fuite de mémoire dont un tiers choisit le débit.
    """
    tenant = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'O')", (tenant,))
    db.conn.commit()
    with core_db.connection(db.url) as conn:
        audit.log_event(
            conn,
            tenant_id=tenant,
            decision="allow",
            tool_name="virement_bancaire",
            origin=audit.Origin.mcp_gateway(),
        )
        conn.commit()

    releve = _relever(TestClient(_app(url=db.url)))
    assert tenant not in releve
    assert "virement_bancaire" not in releve
    assert "tenant" not in releve


def test_a_lost_proof_is_counted_where_a_log_line_used_to_be() -> None:
    """La perte d'une écriture d'audit devient un chiffre qu'on peut mettre sous alerte.

    C'est la seule panne du produit qui touche sa revendication centrale, et elle ne
    laissait qu'une ligne de journal applicatif — invisible à toute supervision.
    """
    registre.compter("xsom_audit_failures_total", ingress="mcp_gateway", stage="decision")
    releve = _relever(TestClient(_app()))
    assert 'xsom_audit_failures_total{ingress="mcp_gateway",stage="decision"} 1' in releve


async def test_the_counter_moves_when_a_real_audit_write_fails(db: DBHandle) -> None:
    """**Le contrôle qui manquait, et il manquait au bon endroit.**

    Le test précédent n'exerce que le registre : il incrémente lui-même. Retirer
    l'instrumentation du site réel — le `except` d'`_audit` — le laissait vert, donc
    il ne gardait rien du câblage. Ici l'écriture échoue pour de vrai : la base
    d'`ApprovalContext` est injoignable, `_audit` avale l'échec comme il l'a toujours
    fait, et c'est le compteur qui doit en rester la trace.

    Les deux sites comptent séparément. Un refus de garde (`stage="gate"`) et une
    décision de policy (`stage="decision"`) n'ont pas les mêmes conséquences : la
    seconde fait refuser l'action sur les classes risquées, la première non.
    """
    from core.policy import parse_policy
    from gateway.server import ApprovalContext, PolicyBackend
    from tests.test_preuve_avant_action import FakeProxy

    injoignable = "postgresql://nobody@127.0.0.1:1/none"
    ctx = ApprovalContext(database_url=injoignable, tenant_id=str(uuid4()))
    policy = parse_policy(
        "tools:\n"
        "  - name: mock.secret\n"
        "    class: read\n"
        "    approval: auto\n"
        "    constraints:\n"
        "      allowed_clients: [autre]\n"
        "defaults:\n"
        "  unknown_tool: deny\n"
        "  auto_classify: true\n"
    )
    backend = PolicyBackend(policy, FakeProxy(), ctx)  # type: ignore[arg-type]

    await backend.call_tool("secret", {})  # refusé par le RBAC → `_audit_gate`
    await backend.call_tool("read_doc", {})  # décision de policy → `_audit`

    releve = _relever(TestClient(_app(url=db.url)))
    assert 'xsom_audit_failures_total{ingress="mcp_gateway",stage="gate"} 1' in releve, (
        "un refus de garde dont la preuve n'a pas pu s'écrire ne laisse aucun chiffre"
    )
    assert 'xsom_audit_failures_total{ingress="mcp_gateway",stage="decision"} 1' in releve, (
        "une décision dont la preuve n'a pas pu s'écrire ne laisse aucun chiffre — "
        "c'est pourtant elle qui fait refuser l'irréversible"
    )


def test_the_judge_reports_why_it_did_not_classify() -> None:
    """`audit_log.judge_used` confond « pas sollicité » et « a échoué ». Ici non.

    Un juge hors budget est une décision commerciale ; un juge qui expire est un
    incident fournisseur. Les deux plancherisent l'ambigu de la même façon — et
    demandent des réactions opposées.
    """
    for issue in ("classified", "failed", "over_budget", "unusable"):
        registre.compter("xsom_judge_calls_total", outcome=issue)
    releve = _relever(TestClient(_app()))
    for issue in ("classified", "failed", "over_budget", "unusable"):
        assert f'xsom_judge_calls_total{{outcome="{issue}"}} 1' in releve


# ---------------------------------------------------------------------------
# Le registre lui-même
# ---------------------------------------------------------------------------
def test_an_undeclared_metric_is_refused_rather_than_silently_created() -> None:
    """Un registre qui accepte n'importe quel nom laisse une faute de frappe créer une
    seconde série que personne ne regarde — pendant que la première continue de bouger.
    """
    local = Registre()
    local.compter("xsom_decisions_totale", decision="allow")  # une lettre de trop
    local.observer("xsom_decisions_total", 3)  # bon nom, mauvais type
    assert local.rendre() == ""


def test_the_registry_refuses_to_grow_without_bound_and_says_so() -> None:
    """Le plafond de séries existe pour le jour où une étiquette cessera d'être fermée.

    Toutes le sont aujourd'hui. Le jour où l'une ne le sera plus, la panne doit être
    un compteur visible et non une mémoire qui monte jusqu'à l'OOM du processus qui
    décide.
    """
    local = Registre()
    for i in range(_MAX_SERIES + 50):
        local.compter("xsom_quota_total", metric=f"m{i}", state="ok")
    rendu = local.rendre()
    assert rendu.count("xsom_quota_total{") <= _MAX_SERIES
    assert "xsom_series_dropped_total" in rendu


def test_a_label_can_never_break_the_exposition_format() -> None:
    """Une valeur d'étiquette est bornée et nettoyée **avant** d'entrer dans une série.

    Un guillemet ou un saut de ligne suffirait sinon à produire un relevé que le
    scrutateur refuse d'analyser — c'est-à-dire à éteindre la supervision depuis une
    donnée d'entrée.
    """
    local = Registre()
    local.compter("xsom_quota_total", metric='x"y\nz', state="ok" * 100)
    lignes = [
        ligne for ligne in local.rendre().splitlines() if ligne.startswith("xsom_quota_total")
    ]

    # Une seule ligne : le saut de ligne n'a pas coupé la série en deux.
    assert len(lignes) == 1
    # Le guillemet et le saut sont devenus des `_`, et la valeur trop longue est bornée.
    assert 'metric="x_y_z"' in lignes[0]
    assert 'state="' + "ok" * 32 + '"' in lignes[0]


def test_the_histogram_buckets_are_cumulative_and_carry_an_infinity_bucket() -> None:
    """Le format Prometheus l'exige, et un histogramme mal rendu est pire que rien :
    le scrutateur l'accepte et calcule des centiles faux."""
    local = Registre()
    for valeur in (0, 3, 3, 900, 5000):
        local.observer("xsom_decision_ms", valeur, ingress="mcp_gateway")
    rendu = local.rendre()
    seaux = [
        int(ligne.rsplit(" ", 1)[1])
        for ligne in rendu.splitlines()
        if ligne.startswith("xsom_decision_ms_bucket")
    ]
    assert seaux == sorted(seaux), "les seaux ne sont pas cumulatifs"
    assert seaux[-1] == 5
    assert 'le="+Inf"' in rendu
    assert "xsom_decision_ms_sum" in rendu
    assert 'xsom_decision_ms_count{ingress="mcp_gateway"} 5' in rendu


def test_the_scrape_reads_no_database_at_all() -> None:
    """On scrute pendant l'incident, c'est-à-dire quand Postgres est peut-être absent.

    Un point de métriques qui tombe avec la base ne dit rien au moment où on en a
    besoin. L'application est construite **sans** DSN : la route doit répondre.
    """
    client = TestClient(_app(url=None))
    reponse = client.get("/v1/ops/metrics", headers={"Authorization": f"Bearer {JETON}"})
    assert reponse.status_code == 200
