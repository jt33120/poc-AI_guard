"""`FR-189` — dériver l'inventaire du Shadow AI sans devenir le SOC du client.

C'est le FR du lot qui passe le plus près d'un non-objectif, et la frontière est
assertée ici plutôt que promise ailleurs : la route n'a **aucun champ** pour une ligne
de journal, et le test le vérifie sur le schéma lui-même. Le jour où quelqu'un en
ajoute un, ce fichier rougit — ce qui est exactement le moment où la question « sommes-
nous encore une attestation ou déjà un CASB ? » doit se poser.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import shadow_ai
from core.config import Settings
from core.schemas import ShadowAiRequest
from tests.conftest import DBHandle

_ACTOR_A = "a" * 32
_ACTOR_B = "b" * 32


def _lines() -> list[str]:
    return [
        f"api.openai.com,42,{_ACTOR_A}",
        f"chatgpt.com,7,{_ACTOR_B}",
        f"claude.ai,3,{_ACTOR_B}",
        f"intranet.acme.fr,9,{_ACTOR_A}",
    ]


# ---------------------------------------------------------------------------
# Le tri
# ---------------------------------------------------------------------------
def test_a_known_host_without_supervision_falls_to_shadow() -> None:
    """Fail-closed, et dans le bon sens.

    Se tromper vers `shadow` fait apparaître un usage peut-être déjà couvert. Se
    tromper vers `supervise` ferait disparaître de l'inventaire exactement ce qu'il
    existe pour montrer.
    """
    obs, _ = shadow_ai.parse_observations(_lines())
    inv = shadow_ai.classify(obs, supervised_hosts=frozenset({"api.openai.com"}))
    assert inv.supervised == {"OpenAI": 1}
    assert inv.shadow == {"Claude": 1, "ChatGPT": 1}
    assert inv.shadow_actors == 2


def test_an_unknown_host_is_counted_never_guessed() -> None:
    """Ranger un hôte inconnu en « pas de l'IA » serait une affirmation que rien
    n'appuie ; le compter dit au lecteur ce que l'inventaire n'a pas su lire."""
    obs, _ = shadow_ai.parse_observations(_lines())
    inv = shadow_ai.classify(obs, supervised_hosts=frozenset())
    assert inv.unclassified == 1


def test_a_lookalike_host_is_not_the_service() -> None:
    """Comparaison par suffixe de label, pas par sous-chaîne."""
    assert shadow_ai.service_for("notopenai.com") is None
    assert shadow_ai.service_for("eu.api.openai.com") == "OpenAI"
    assert shadow_ai.service_for("api.openai.com.evil.test") is None


def test_a_line_carrying_content_is_rejected_not_truncated() -> None:
    """La frontière DLP tenue **à l'entrée**.

    Tronquer supposerait d'avoir lu l'URL — donc d'avoir accepté du contenu. Le rejet
    est la seule réponse qui laisse la promesse « aucun contenu n'entre » vraie.
    """
    obs, rejets = shadow_ai.parse_observations(
        [
            f"api.openai.com/v1/chat?key=secret,1,{_ACTOR_A}",
            f"api.openai.com:443,1,{_ACTOR_A}",
            "api.openai.com,1,jean.dupont@acme.fr",
            f"api.openai.com,1,{_ACTOR_A}",
        ]
    )
    assert rejets == 3
    assert [o.host for o in obs] == ["api.openai.com"]


def test_rejected_lines_are_counted_and_published() -> None:
    """Un inventaire tiré d'un extrait à moitié illisible, présenté comme complet,
    serait pire que pas d'inventaire."""
    obs, rejets = shadow_ai.parse_observations([*_lines(), "malformé", "aussi,malformé"])
    inv = shadow_ai.classify(obs, supervised_hosts=frozenset(), rejected=rejets)
    assert inv.rejected == 2
    assert shadow_ai.attestation_section(inv)["rejected_lines"] == 2


def test_an_absent_inventory_is_published_as_absent() -> None:
    """Le silence se lirait « aucun Shadow AI », qui est l'inverse de la vérité."""
    section = shadow_ai.attestation_section(None)
    assert section["declared"] is False
    assert "n'est pas une absence" in section["basis"]


def test_the_catalogue_is_not_a_setting() -> None:
    """Un catalogue que le client édite n'atteste que de ce qu'il a bien voulu y mettre.

    Le test ne vérifie pas une valeur mais une **propriété de conception** : la table
    vit dans le module, et aucun réglage ne la remplace.
    """
    from core.config import Settings as S

    champs = set(S.model_fields)
    assert not [f for f in champs if "shadow" in f or "ai_host" in f]
    assert shadow_ai.KNOWN_AI_HOSTS["chatgpt.com"] == "ChatGPT"


# ---------------------------------------------------------------------------
# La frontière, assertée sur le schéma
# ---------------------------------------------------------------------------
def test_the_route_has_no_field_that_could_carry_a_log_line() -> None:
    """Le schéma **est** la frontière.

    Il n'y a aucun champ pour une ligne de journal, une URL, un hôte ou un
    identifiant : la route ne peut donc pas recevoir de brut, même si quelqu'un le lui
    envoyait. C'est ce qui sépare une attestation d'un CASB, et c'est pour cela que la
    garde vit dans le type plutôt que dans une consigne.
    """
    champs = set(ShadowAiRequest.model_fields)
    assert champs == {
        "window_start",
        "window_end",
        "supervised",
        "shadow",
        "unclassified",
        "rejected",
    }
    # `extra="forbid"` : un champ ajouté par l'appelant est refusé, pas ignoré.
    assert ShadowAiRequest.model_config["extra"] == "forbid"


# ---------------------------------------------------------------------------
# De bout en bout
# ---------------------------------------------------------------------------
def _client(url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=url))
    app.state.verifier = verifier
    return TestClient(app)


def _tenant(db: DBHandle) -> str:
    tid = uuid4()
    db.conn.execute("insert into tenants (id, name) values (%s, 'A')", (tid,))
    db.conn.commit()
    return str(tid)


def _payload(**kw: object) -> dict[str, object]:
    now = datetime.now(UTC)
    return {
        "window_start": (now - timedelta(days=30)).isoformat(),
        "window_end": now.isoformat(),
        "supervised": {"OpenAI": 1},
        "shadow": {"ChatGPT": 4, "Claude": 2},
        "unclassified": 3,
        "rejected": 1,
        **kw,
    }


def test_an_admin_declares_and_the_pack_carries_it(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    from core import audit, compliance

    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='admin')}"}

    posted = client.put("/v1/shadow-ai", headers=admin, json=_payload())
    assert posted.status_code == 200
    assert posted.json()["shadow_actors"] == 6

    pack = compliance.build_evidence_pack(
        db.conn, tenant_id=tid, events=audit.list_events(db.conn), approvals=[]
    )
    section = pack["articles"]["article_26_deployer"]["shadow_ai"]
    assert section["declared"] is True
    assert section["shadow_actors"] == 6
    assert section["unclassified_hosts"] == 3
    assert "ne collecte aucun trafic" in section["basis"]


def test_a_viewer_may_read_but_not_declare(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Déposer engage le tenant devant un auditeur : action d'admin."""
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    viewer = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='viewer')}"}

    assert client.put("/v1/shadow-ai", headers=viewer, json=_payload()).status_code == 403
    lu = client.get("/v1/shadow-ai", headers=viewer)
    assert lu.status_code == 200 and lu.json()["declared"] is False


def test_a_second_declaration_replaces_the_first(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """La ressource est « l'inventaire courant », pas un historique — comme `corpora`."""
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='admin')}"}

    client.put("/v1/shadow-ai", headers=admin, json=_payload())
    client.put("/v1/shadow-ai", headers=admin, json=_payload(shadow={"ChatGPT": 1}))

    n = db.conn.execute("select count(*) from shadow_ai_inventory").fetchone()
    assert n is not None and n[0] == 1
    assert client.get("/v1/shadow-ai", headers=admin).json()["shadow_actors"] == 1


def test_a_window_that_ends_before_it_starts_is_refused(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Un inventaire sans fenêtre cohérente ne dit pas de quoi il parle."""
    tid = _tenant(db)
    client = _client(db.url, test_verifier)
    admin = {"Authorization": f"Bearer {make_token(tenant_id=tid, role='admin')}"}
    now = datetime.now(UTC)

    refuse = client.put(
        "/v1/shadow-ai",
        headers=admin,
        json=_payload(
            window_start=now.isoformat(), window_end=(now - timedelta(days=1)).isoformat()
        ),
    )
    # 422 et non 500 : c'est une erreur de client, et elle se dit au bord. La
    # contrainte SQL existe aussi — une garde qui ne vit que dans le schéma d'API
    # laisse passer ce qui entre par une autre porte — mais la laisser lever depuis la
    # base rendrait une trace, ce que `CLAUDE.md` §4.8 interdit.
    assert refuse.status_code == 422
