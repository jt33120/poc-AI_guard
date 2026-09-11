"""Le droit d'un tenant : ce qu'il porte, ce qu'il ne porte pas, et le doute.

Le module qui charge un droit a une propriété qui ne se lit pas dans son code :
**son repli n'est pas `free`**. Une relecture voit `return AUCUNE` et passe. Ce
fichier grave la raison — un tenant dont on ne sait rien n'est pas un tenant en
découverte, et retomber sur `free` accorderait neuf capacités sur la foi d'une
lecture ratée, d'un identifiant inconnu ou d'un seed à moitié appliqué.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.security import TokenVerifier
from core import db as core_db
from core import entitlements
from core.config import Settings
from core.entitlements import AUCUNE, Capability, Meter, Metric
from tests.conftest import DBHandle

_MIGRATIONS = Path(__file__).resolve().parent.parent / "supabase" / "migrations"
_MIGRATION = _MIGRATIONS / "0030_saas_plans.sql"
_DEMONSTRATION = _MIGRATIONS / "0033_palier_de_demonstration.sql"


def _tenant(db: DBHandle, plan: str = "pro") -> str:
    tid = uuid4()
    db.conn.execute("insert into tenants (id, name, plan) values (%s, 'A', %s)", (tid, plan))
    db.conn.commit()
    return str(tid)


# ---------------------------------------------------------------------------
# 1. Ce que la base refuse d'écrire
# ---------------------------------------------------------------------------


def test_a_mistyped_capability_is_refused_by_the_database(db: DBHandle) -> None:
    """La faute de frappe est refusée à l'OCTROI, pas silencieusement à la lecture.

    Sans le catalogue, `plan_capabilities.capability` est un `text` libre et
    `('pro','judgee')` est accepté. Le résultat n'est pas une erreur : c'est un 402
    **permanent** sur une fonctionnalité vendue, découvert par un appel client des
    semaines plus tard, et introuvable parce que rien n'a échoué.
    """
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        db.conn.execute("insert into plan_capabilities values ('pro', 'judgee')")
    db.conn.rollback()


def test_a_metric_cannot_change_shape_between_plans(db: DBHandle) -> None:
    """La clé étrangère est **composite**, et c'est ce qui tient la forme.

    Une métrique `flux` dans un palier et `stock` dans un autre serait comptée par
    deux codes différents selon le client : l'un remet à zéro chaque mois, l'autre
    non. Le catalogue porte la forme une fois pour toutes.
    """
    # La ligne est retirée d'abord : les trente combinaisons (palier, métrique)
    # existent au seed, et la clé primaire lèverait avant la clé étrangère — le test
    # passerait alors pour la mauvaise raison.
    db.conn.execute("delete from plan_limits where plan = 'pro' and metric = 'decisions'")
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        db.conn.execute(
            "insert into plan_limits (plan, metric, shape, limit_value) "
            "values ('pro', 'decisions', 'stock', 10)"
        )
    db.conn.rollback()


def test_an_unlimited_quota_cannot_be_written_as_an_absence(db: DBHandle) -> None:
    """« Illimité » ne s'écrit pas NULL, et la base le refuse.

    Un NULL demanderait une branche de code qui saute la comparaison — donc un
    chemin où le plafond ne s'applique pas — et il ressemble exactement à une
    lecture ratée. Un très grand nombre passe par la même ligne de code que 10 000.
    """
    with pytest.raises(psycopg.errors.NotNullViolation):
        db.conn.execute(
            "insert into plan_limits (plan, metric, shape, limit_value) "
            "values ('pro', 'seats', 'stock', null)"
        )
    db.conn.rollback()


# ---------------------------------------------------------------------------
# 2. Le repli, et pourquoi ce n'est pas `free`
# ---------------------------------------------------------------------------


def test_an_unknown_tenant_gets_nothing_and_not_the_free_plan(db: DBHandle) -> None:
    """Le repli tentant, refusé explicitement.

    `free` porte neuf capacités. Les accorder à un identifiant que la base ne
    connaît pas — un jeton d'un ancien déploiement, un tenant supprimé, une faute de
    frappe — serait ouvrir sur une absence de réponse. `AUCUNE` porte le palier
    `unknown` justement pour que la trace le dise.
    """
    droit = entitlements.load_entitlement(db.conn, str(uuid4()))

    assert droit is AUCUNE
    assert droit.plan == "unknown"
    assert droit.capabilities == frozenset()
    assert not droit.allows(Capability.authorize), (
        "même la capacité la plus fondamentale n'est pas accordée sur une lecture "
        "ratée — c'est ce qui distingue ce repli de `free`"
    )


def test_a_plan_with_no_capabilities_is_treated_as_unknown(db: DBHandle) -> None:
    """Un seed à moitié appliqué ressemble à un palier, et n'en est pas un.

    Le tenant existe, sa colonne `plan` porte une valeur légale, et pourtant la
    table d'octroi est vide. Deviner « c'est sûrement free » ici accorderait des
    droits sur la foi d'une migration incomplète.
    """
    tenant = _tenant(db, "pro")
    db.conn.execute("delete from plan_capabilities where plan = 'pro'")
    db.conn.commit()

    assert entitlements.load_entitlement(db.conn, tenant) is AUCUNE


def test_the_entry_tier_is_the_demonstration_one_and_reverting_is_one_statement() -> None:
    """Le palier d'entrée est celui de la démonstration, et il se referme d'une ligne.

    `0030` déclarait `free` — le palier le plus restreint, donc la direction
    fail-closed. `0033` l'ouvre en grand pendant la démonstration : le produit n'est
    pas facturé, et un inscrit qui découvre neuf capacités sur trente-sept les
    découvre par un 402, pas par la page qui l'a fait venir.

    Ce que ce contrôle tient n'est pas la valeur — c'est la **forme du retour
    arrière**. `0030` garde sa déclaration intacte, `0033` ne fait que déplacer le
    défaut, et remettre `free` reste donc un seul `alter`. Une bascule qui aurait
    réécrit les vingt-huit lignes de la grille coûterait, elle, une migration de
    restauration.
    """
    grille = _MIGRATION.read_text(encoding="utf-8")
    demo = _DEMONSTRATION.read_text(encoding="utf-8")
    # Les commentaires NOMMENT `mcp_gateway_enabled` — c'est là qu'il faut en parler.
    # Ce qu'on interdit, c'est de le toucher, donc on lit les seules instructions.
    instructions = "\n".join(
        ligne for ligne in demo.splitlines() if not ligne.lstrip().startswith("--")
    )

    assert "add column if not exists plan text not null default 'free'" in grille, (
        "la gamme garde son propre défaut : c'est lui qu'on remet quand la facturation arrive"
    )
    assert "alter table tenants alter column plan set default 'entreprise'" in instructions
    assert "plan_capabilities" not in instructions and "plan_limits" not in instructions, (
        "la démonstration déplace le palier d'entrée, elle ne redéfinit aucun palier"
    )
    assert "update tenants" not in instructions.lower(), (
        "déplacer les tenants déjà inscrits passe par `cli plan set`, qui écrit "
        "l'entrée chaînée dans la même transaction ; un update en masse laisserait "
        "un palier que `tenant_plan_changes` ne raconte pas"
    )


# ---------------------------------------------------------------------------
# 3. Les quotas négociés
# ---------------------------------------------------------------------------


def test_a_negotiated_override_replaces_the_plan_number(db: DBHandle) -> None:
    tenant = _tenant(db, "pro")
    db.conn.execute(
        "insert into tenant_quota_overrides (tenant_id, metric, limit_value, reason) "
        "values (%s, 'agents', 42, 'contrat cadre')",
        (tenant,),
    )
    db.conn.commit()

    droit = entitlements.load_entitlement(db.conn, tenant)
    limite = droit.limite(Metric.agents)
    assert limite is not None and limite.valeur == 42


def test_an_expired_override_falls_back_to_the_plan_and_not_to_its_own_number(
    db: DBHandle,
) -> None:
    """Un plafond négocié qui expire redevient celui du palier, pas le sien.

    C'est la faute qu'un `left join` naïf commet : la ligne existe toujours, donc
    elle gagne. Le client garderait son plafond de faveur indéfiniment après la fin
    du contrat, et personne ne s'en plaindrait — c'est bien le problème.
    """
    tenant = _tenant(db, "pro")
    db.conn.execute(
        "insert into tenant_quota_overrides (tenant_id, metric, limit_value, reason, expires_at) "
        "values (%s, 'agents', 999, 'essai', %s)",
        (tenant, datetime.now(UTC) - timedelta(days=1)),
    )
    db.conn.commit()

    limite = entitlements.load_entitlement(db.conn, tenant).limite(Metric.agents)
    assert limite is not None
    assert limite.valeur == 10, "le chiffre du palier `pro`, pas les 999 du contrat échu"


def test_an_override_on_a_metric_the_plan_does_not_define_stays_invisible(db: DBHandle) -> None:
    """Le `left join` part de `plan_limits`, et c'est ce qui tient cette propriété.

    Négocier un plafond ne doit pas pouvoir **créer** une métrique dans un palier :
    ce serait accorder une capacité par la porte des chiffres, précisément ce que la
    séparation quotas/capacités refuse.
    """
    tenant = _tenant(db, "free")
    db.conn.execute("delete from plan_limits where plan = 'free' and metric = 'clients'")
    db.conn.execute(
        "insert into tenant_quota_overrides (tenant_id, metric, limit_value, reason) "
        "values (%s, 'clients', 50, 'geste commercial')",
        (tenant,),
    )
    db.conn.commit()

    assert entitlements.load_entitlement(db.conn, tenant).limite(Metric.clients) is None


# ---------------------------------------------------------------------------
# 4. Les compteurs, et le doute
# ---------------------------------------------------------------------------


def test_meter_never_reads_an_unreadable_counter_as_a_clean_one(db: DBHandle) -> None:
    """`None` et `0` sont deux réponses différentes, et les confondre ouvre la porte.

    Une lecture ratée qui se lit « rien de consommé » offre exactement la fenêtre
    qu'un abus cherche : couper le compteur, puis consommer. `Meter.unknown` existe
    pour que l'appelant décide, avec la classe d'action en main.
    """
    droit = entitlements.load_entitlement(db.conn, _tenant(db, "pro"))

    assert entitlements.meter(droit, Metric.decisions, consomme=0) is Meter.ok
    assert entitlements.meter(droit, Metric.decisions, consomme=None) is Meter.unknown


def test_the_grace_band_sits_between_the_limit_and_the_cap(db: DBHandle) -> None:
    """La tolérance sert à PRÉVENIR, pas à excuser.

    Un client qui découvre son plafond par une panne ne renouvelle pas. Les trois
    états sont donc distincts, et `grace` est celui pendant lequel on écrit et on
    alerte sans rien resserrer.
    """
    droit = entitlements.load_entitlement(db.conn, _tenant(db, "pro"))
    limite = droit.limite(Metric.decisions)
    assert limite is not None and limite.grace_pct == 10

    assert entitlements.meter(droit, Metric.decisions, consomme=limite.valeur - 1) is Meter.ok
    assert entitlements.meter(droit, Metric.decisions, consomme=limite.valeur) is Meter.grace
    assert (
        entitlements.meter(droit, Metric.decisions, consomme=limite.plafond_avec_grace)
        is Meter.capped
    )


def test_a_stock_has_no_grace_and_refuses_an_unreadable_ceiling(db: DBHandle) -> None:
    """Un `stock` est compté à la création : un dépassement toléré ne se rattrape pas.

    Il faudrait supprimer quelque chose que le client a créé. Et un plafond que le
    palier ne définit pas refuse : un objet qu'on ne peut pas compter est un objet
    qu'on ne crée pas.
    """
    droit = entitlements.load_entitlement(db.conn, _tenant(db, "free"))

    assert entitlements.stock_allows(droit, Metric.agents, actuel=0) is True
    assert entitlements.stock_allows(droit, Metric.agents, actuel=1) is False
    assert entitlements.stock_allows(AUCUNE, Metric.agents, actuel=0) is False


# ---------------------------------------------------------------------------
# 5. Le verrou vu depuis l'API
# ---------------------------------------------------------------------------


def _client(db_url: str, verifier: TokenVerifier) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.verifier = verifier
    return TestClient(app)


def test_a_free_tenant_is_refused_a_pro_route_with_402_not_403(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """402 et non 403, et la distinction n'est pas cosmétique.

    403 dit « vous n'avez pas le droit » — la console montre l'écran de permission,
    le support cherche un rôle mal attribué. 402 dit « pas à ce prix » — la console
    montre l'offre. Deux tickets qui se ressemblent et ne se traitent pas pareil.
    """
    tenant = _tenant(db, "free")
    client = _client(db.url, test_verifier)
    jeton = make_token(tenant_id=tenant, role="admin")

    refuse = client.get("/v1/corpora", headers={"Authorization": f"Bearer {jeton}"})
    assert refuse.status_code == 402
    assert "corpora" in refuse.json()["detail"]

    # Et ce qui est dans le plancher répond, sur le même palier et le même jeton :
    # sans cette moitié, un verrou qui refuserait tout passerait aussi.
    libre = client.get("/v1/approvals", headers={"Authorization": f"Bearer {jeton}"})
    assert libre.status_code == 200


def test_an_entitlement_is_never_served_from_memory(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Une rétrogradation prend effet au prochain appel, pas au prochain redémarrage.

    Un droit mis en cache est un droit qu'on ne peut plus retirer, et la fenêtre
    pendant laquelle il survit est exactement celle où le client a intérêt à
    continuer. Le coût est une requête par appel de route verrouillée ; c'est le
    prix d'un droit révocable.
    """
    tenant = _tenant(db, "entreprise")
    client = _client(db.url, test_verifier)
    entetes = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}

    assert client.get("/v1/corpora", headers=entetes).status_code == 200

    db.conn.execute("update tenants set plan = 'free' where id = %s", (tenant,))
    db.conn.commit()

    assert client.get("/v1/corpora", headers=entetes).status_code == 402


def test_a_tenant_cannot_promote_itself(db: DBHandle) -> None:
    """Le jour où une route console écrira `plan`, un admin de tenant s'auto-promeut.

    `0001` ne donne que `select` sur `tenants`, et `0030` grave le `revoke` plutôt
    que de le laisser à une note de revue. Le contrôle passe par le vrai chemin de
    lecture tenant (`db.tenant_reader`), donc par le rôle `authenticated`.
    """
    tenant = _tenant(db, "free")
    with (
        core_db.tenant_reader(db.url, user_id="u1", tenant_id=tenant, role="admin") as conn,
        pytest.raises(psycopg.errors.InsufficientPrivilege),
    ):
        conn.execute("update tenants set plan = 'entreprise'")


def test_a_free_tenant_cannot_mint_a_second_agent(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Le plafond de stock, compté au point de création et pas au tableau de bord.

    409 et non 402 : la fonctionnalité **est** dans le palier `free`, c'est le
    nombre qui est atteint. Et le message nomme le plafond — un refus qui ne dit pas
    combien laisse l'utilisateur réessayer.
    """
    tenant = _tenant(db, "free")
    client = _client(db.url, test_verifier)
    entetes = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}

    premier = client.post("/v1/gateway-tokens", headers=entetes, json={"name": "bot-1"})
    assert premier.status_code in (200, 201), premier.text

    second = client.post("/v1/gateway-tokens", headers=entetes, json={"name": "bot-2"})
    assert second.status_code == 409
    assert "1 agents" in second.json()["detail"]


def test_a_revoked_agent_frees_its_slot(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Un jeton révoqué n'occupe plus de place, et c'est une décision.

    Compter les jetons **vivants** plutôt que toutes les lignes évite qu'un client
    atteigne son plafond avec des identités qui ne peuvent plus rien faire — un
    plafond qu'on ne peut pas libérer se lit comme une panne, pas comme une offre.
    """
    tenant = _tenant(db, "free")
    client = _client(db.url, test_verifier)
    entetes = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}

    premier = client.post("/v1/gateway-tokens", headers=entetes, json={"name": "bot-1"}).json()
    assert client.post("/v1/gateway-tokens", headers=entetes, json={"name": "x"}).status_code == 409

    assert client.delete(f"/v1/gateway-tokens/{premier['id']}", headers=entetes).status_code == 204
    rejoue = client.post("/v1/gateway-tokens", headers=entetes, json={"name": "bot-2"})
    assert rejoue.status_code in (200, 201), rejoue.text


def test_a_stock_ceiling_that_cannot_be_read_refuses_the_creation(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Un objet qu'on ne peut pas compter est un objet qu'on ne crée pas.

    Le palier du tenant est vidé de ses plafonds : `stock_allows` ne trouve plus de
    limite et refuse, plutôt que de laisser passer « puisqu'on ne sait pas ». C'est
    la même direction que partout ailleurs dans ce dépôt (`AD-10`), appliquée à la
    facturation — où la tentation inverse est forte, parce qu'un refus coûte un
    client et qu'un laisser-passer ne coûte rien tout de suite.
    """
    tenant = _tenant(db, "free")
    db.conn.execute("delete from plan_limits where plan = 'free' and metric = 'agents'")
    db.conn.commit()
    client = _client(db.url, test_verifier)
    entetes = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}

    refuse = client.post("/v1/gateway-tokens", headers=entetes, json={"name": "bot"})
    assert refuse.status_code == 409


def test_a_free_tenant_gets_no_client_slot_at_all(
    db: DBHandle, test_verifier: TokenVerifier, make_token: Callable[..., str]
) -> None:
    """Un plafond à zéro refuse dès le premier, et sans capacité c'est un 402.

    Les deux verrous se superposent volontairement : `free` n'a pas la capacité
    `clients`, donc la route répond 402 avant même de compter. Le plafond à zéro est
    la seconde ligne, celle qui tient si la capacité est un jour accordée à `free`
    sans que le chiffre suive.
    """
    tenant = _tenant(db, "free")
    client = _client(db.url, test_verifier)
    entetes = {"Authorization": f"Bearer {make_token(tenant_id=tenant, role='admin')}"}

    assert client.post("/v1/clients", headers=entetes, json={"name": "ACME"}).status_code == 402

    db.conn.execute("insert into plan_capabilities values ('free', 'clients')")
    db.conn.commit()
    refuse = client.post("/v1/clients", headers=entetes, json={"name": "ACME"})
    assert refuse.status_code == 409, refuse.text
    assert "0 clients" in refuse.json()["detail"]


def test_signing_up_writes_the_entry_into_the_plan_history(db: DBHandle) -> None:
    """L'histoire d'un palier commence à l'inscription, pas à la première contestation.

    Sans cette ligne, `tenant_plan_changes` d'un tenant est vide jusqu'au jour où on
    le rétrograde, et la première entrée de son histoire est celle qu'il conteste.
    « Depuis quand suis-je sur ce palier ? » n'a alors pas de réponse.

    **Le palier attendu est relu, pas écrit ici**, et c'est ce que `0033` a mis au
    jour. L'inscription laisse la colonne décider du palier puis écrivait `free` en
    dur dans la chaîne ; ce contrôle écrivait le même littéral, si bien que les deux
    s'accordaient sur une valeur que la base ne donnait déjà plus — la fixture fait
    naître les tenants `entreprise`. Un test qui recopie la constante du code ne
    vérifie que la constante.
    """
    from core import plan_changes, signup
    from tests.test_signup import FakeAuthAdmin

    compte = signup.provision_account(
        db.conn,
        FakeAuthAdmin(db.url),  # type: ignore[arg-type]
        org="ACME",
        email="a@exemple.fr",
        password="s3cretpw!",  # court à dessein : `audit_security` flaire un littéral long
    )

    palier = db.conn.execute(
        "select plan from tenants where id = %s", (compte["tenant_id"],)
    ).fetchone()[0]
    histoire = plan_changes.history(db.conn, compte["tenant_id"])
    assert [(h["from_tier"], h["to_tier"], h["reason"]) for h in histoire] == [
        (None, palier, "signup")
    ]
    assert plan_changes.verify_chain(db.conn, compte["tenant_id"]).ok is True


def test_the_plan_history_refuses_to_be_rewritten(db: DBHandle) -> None:
    """Une histoire qu'un `update` réécrit ne répond à aucun litige.

    C'est la raison d'être de la table : `tenants.plan_since` est écrasé à chaque
    mouvement, et une seconde colonne mutable n'aurait rien apporté.
    """
    from core import plan_changes

    tenant = _tenant(db, "free")
    plan_changes.record(
        db.conn,
        tenant_id=tenant,
        from_tier="free",
        to_tier="pro",
        reason=plan_changes.Raison.checkout,
        actor="op-1",
    )
    db.conn.commit()

    for sql in (
        "update tenant_plan_changes set to_tier = 'free'",
        "delete from tenant_plan_changes",
        "truncate tenant_plan_changes",
    ):
        with pytest.raises(psycopg.errors.RaiseException):
            db.conn.execute(sql)
        db.conn.rollback()


def test_a_free_text_reason_is_refused_by_the_schema(db: DBHandle) -> None:
    """Le vocabulaire fermé est ce qui vaut la table, pas la table.

    « dunning, le 3 mars, acteur billing » se répond en une requête et un mot. Un
    champ libre donnerait autant de formulations que d'opérateurs, et la question du
    litige resterait sans réponse mécanique.
    """
    tenant = _tenant(db, "free")
    with pytest.raises(psycopg.errors.CheckViolation):
        db.conn.execute(
            "insert into tenant_plan_changes "
            " (tenant_id, to_tier, reason, entry_digest, prev_hash, entry_hash) "
            "values (%s, 'pro', 'le client a insisté', 'd', 'p', 'e')",
            (tenant,),
        )
    db.conn.rollback()
