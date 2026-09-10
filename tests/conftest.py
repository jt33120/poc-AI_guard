"""Shared pytest fixtures (HTTP client, auth/JWT, ephemeral Postgres)."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jose import jwk, jwt
from psycopg import sql

from api.main import create_app
from api.security import TokenVerifier
from core import audit
from core.config import Settings
from tests import pgcluster

_REPO = Path(__file__).resolve().parent.parent
_SHIM_SQL = _REPO / "tests" / "fixtures" / "supabase_auth_shim.sql"
_MIGRATIONS_DIR = _REPO / "supabase" / "migrations"
_TEST_KID = "test-key"


# ---------------------------------------------------------------------------
# Settings / HTTP client
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _hermetic_settings_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Clear every environment name `Settings` reads, before each test.

    `Settings` has no `env_prefix`, so it reads bare names — `SUPABASE_URL`,
    `MISTRAL_API_KEY`, `SENTRY_DSN`. Tests pass `_env_file=None`, which disables the
    `.env` *file* and nothing else: `os.environ` still wins. The suite's verdict
    therefore depended on the developer's shell, and it silently did the wrong
    thing in exactly the tests that matter — a machine with `MISTRAL_API_KEY`
    exported reported the judge as configured, so `doctor` looked healthier than
    the deployment was, and a machine with `SUPABASE_URL` set reported an issuer
    that no configuration had provided. Both pass in CI, where neither is set.

    Derived from `model_fields` rather than listed, so a setting added tomorrow is
    covered without anyone remembering this fixture exists.
    """
    for field in Settings.model_fields:
        monkeypatch.delenv(field.upper(), raising=False)
        monkeypatch.delenv(field.lower(), raising=False)


@pytest.fixture
def dev_settings() -> Settings:
    """Deterministic dev settings, isolated from any local .env file."""
    return Settings(_env_file=None, env="dev", cors_allow_origins=["http://localhost:3000"])


@pytest.fixture
def client(dev_settings: Settings) -> TestClient:
    return TestClient(create_app(dev_settings))


# ---------------------------------------------------------------------------
# Auth: RSA keypair, JWKS, token factory, verifier, authenticated client
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def rsa_keys() -> tuple[str, dict[str, Any]]:
    """A signing private key (PEM) and the matching public JWK for the JWKS."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = (
        key.public_key()
        .public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode()
    )
    public_jwk = jwk.construct(public_pem, "RS256").to_dict()
    public_jwk = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in public_jwk.items()}
    public_jwk.update({"kid": _TEST_KID, "use": "sig", "alg": "RS256"})
    return private_pem, public_jwk


@pytest.fixture
def make_token(rsa_keys: tuple[str, dict[str, Any]]) -> Callable[..., str]:
    """Factory minting signed RS256 JWTs that the test verifier accepts."""
    private_pem, _ = rsa_keys

    def _make(
        *,
        sub: str | None = None,
        tenant_id: str | None = None,
        role: str | None = None,
        aud: str = "authenticated",
        exp_delta: int = 3600,
        **extra: Any,
    ) -> str:
        now = int(time.time())
        app_metadata: dict[str, Any] = {}
        if tenant_id is not None:
            app_metadata["tenant_id"] = tenant_id
        if role is not None:
            app_metadata["role"] = role
        claims: dict[str, Any] = {
            "sub": sub or str(uuid4()),
            "aud": aud,
            "iat": now,
            "exp": now + exp_delta,
            "app_metadata": app_metadata,
        }
        claims.update(extra)
        return jwt.encode(claims, private_pem, algorithm="RS256", headers={"kid": _TEST_KID})

    return _make


@pytest.fixture
def test_verifier(rsa_keys: tuple[str, dict[str, Any]]) -> TokenVerifier:
    _, public_jwk = rsa_keys
    return TokenVerifier(jwks_source=lambda: {"keys": [public_jwk]}, audience="authenticated")


@pytest.fixture
def auth_client(dev_settings: Settings, test_verifier: TokenVerifier) -> TestClient:
    """Client whose app verifies tokens with the local test keypair."""
    app = create_app(dev_settings)
    app.state.verifier = test_verifier
    return TestClient(app)


# ---------------------------------------------------------------------------
# Ephemeral PostgreSQL (real RLS testing)
# ---------------------------------------------------------------------------
@dataclass
class DBHandle:
    url: str
    conn: psycopg.Connection


@pytest.fixture(scope="session")
def pg_cluster() -> Iterator[pgcluster.EphemeralPostgres]:
    if not pgcluster.binaries_available():
        pytest.skip("PostgreSQL server binaries unavailable")
    cluster = pgcluster.EphemeralPostgres()
    cluster.start()
    try:
        yield cluster
    finally:
        cluster.stop()


@pytest.fixture
def db(pg_cluster: pgcluster.EphemeralPostgres) -> Iterator[DBHandle]:
    """A fresh database with the auth shim + product migrations applied."""
    dbname = f"t_{uuid4().hex[:12]}"
    admin = psycopg.connect(pg_cluster.base_url(), autocommit=True)
    admin.execute(sql.SQL("create database {}").format(sql.Identifier(dbname)))
    url = pg_cluster.url_for(dbname)
    pg_cluster.psql_apply(url, _SHIM_SQL)
    for migration in sorted(_MIGRATIONS_DIR.glob("*.sql")):
        pg_cluster.psql_apply(url, migration)
    conn = psycopg.connect(url)
    try:
        yield DBHandle(url=url, conn=conn)
    finally:
        conn.close()
        admin.execute(sql.SQL("drop database {} with (force)").format(sql.Identifier(dbname)))
        admin.close()


def mint_agent(db: DBHandle, tenant_id: str, name: str = "agent") -> str:
    """L'identifiant d'un jeton de passerelle **vivant** — l'identité réelle d'un agent.

    Le harnais passait jusqu'ici des identifiants synthétiques (`"agent-1"`,
    `"tok-observed"`) : `session_taint.gateway_token_id` est un `text`, donc rien ne
    s'y opposait. Ils décrivaient pourtant un agent dont le jeton n'existe pas, ce
    qu'aucune session de production ne peut être — `authenticate_gateway_session` est
    la seule façon d'en obtenir un.

    Depuis `FR-166` la passerelle relit ce jeton à chaque appel pour savoir si un
    opérateur a arrêté l'agent, donc la fiction ne tient plus : elle se lit comme un
    jeton introuvable, c'est-à-dire révoqué. Les tests qui exercent la passerelle
    portent maintenant une identité que la base connaît.
    """
    from core import tenant_tokens

    _, view = tenant_tokens.mint(db.conn, tenant_id=tenant_id, name=name)
    db.conn.commit()
    return str(view["id"])


# --- Coverage scenarios (AD-26, AD-30) ---------------------------------------
# A gate test may declare the coverage facet it proves:
#
#     @pytest.mark.covers("M-06", "chaine", ingress="mcp", sens="bloque")
#
# `sens` says which part of the claim the test carries. A `Bloqué` facet needs all
# three, and each answers a question the other two leave open:
#
#   bloque           the dangerous action was refused, and the downstream was never
#                    invoked;
#   laisse_passer    a legitimate action still went through -- a guard that refuses
#                    everything is not a control, it is an outage, and the blocking
#                    test stays green on a gateway that blocks blindly;
#   controle_negatif with that guard disabled, the *same dangerous action* reaches
#                    the downstream (`AD-30.3`).
#
# The third is the one that is easy to argue away and hardest to do without. Without
# it, a passing `bloque` proves only that nothing happened -- and a crash, an
# unreachable downstream or a misspelt tool name all satisfy "the defence held and
# the downstream was not invoked". `laisse_passer` does not close it either: it
# exercises a *different* invocation, so it cannot tell whether the dangerous one
# was stopped by the guard or was never going to arrive.
#
# A test asserting several parts carries several markers.
#
# The run records every marked test's outcome to `coverage/.scenarios.json`, and
# `scripts/gen_coverage.py` folds that into the published map. A test that did not
# run, or did not pass, proves nothing -- there is no third state.

#: Closed vocabulary. A fourth part of a claim has to be named here *and* taught to
#: `scripts/gen_coverage.py`, so it cannot arrive as a free-form string that the gate
#: then silently ignores.
#: Le vocabulaire des sens, un par preuve exigible de la doctrine (§1).
#: `detecte` et `verdict_tiers` sont arrivés avec la généralisation de `CM-7` aux
#: modes `D` et `O` : jusque-là ces deux modes se publiaient sans qu'aucun scénario
#: n'ait à exister.
_SENS = frozenset({"bloque", "laisse_passer", "controle_negatif", "detecte", "verdict_tiers"})

_SCENARIOS_OUT = _REPO / "coverage" / ".scenarios.json"
_scenarios_key = pytest.StashKey[list[dict[str, Any]]]()

# --- La séquence d'audit de chaque scénario (`L6`) ------------------------------
#
# `AD-26` : une vidéo est l'enregistrement d'une exécution qui passe, jamais un
# substitut. Le rejeu publié sur la page est donc **capturé ici**, pendant la suite,
# et non rejoué, reconstitué ou animé à la main.
#
# Chaque test marqué reçoit une base neuve : son `audit_log` **est** sa séquence, il
# n'y a rien à soustraire. Les colonnes retenues sont celles que le produit accepte
# déjà de journaliser — métadonnées et empreintes, jamais d'arguments (`CLAUDE.md`
# §4.10). Trois sont écartées, et pour des raisons différentes :
#
# * `latency_ms`, parce que `perf/overhead.json` refuse explicitement de publier une
#   latence et qu'une page qui en afficherait une contredirait l'artefact du produit ;
# * `tenant_id` et `user_id`, qui n'apprennent rien à un lecteur ;
# * `ts`, parce que seul l'ordre compte et qu'une horloge de test n'est pas une
#   information.
_SEQUENCES_OUT = _REPO / "coverage" / ".sequences.json"

#: Les colonnes publiables d'une entrée d'audit, dans l'ordre où on les lit.
#:
#: `entry_hash` et `prev_hash` n'en sont **pas**, et pour une raison de fond :
#: `payload_v1` hache `ts`, `tenant_id`, `request_id` et `latency_ms`, tous variables
#: d'une exécution à l'autre. Un artefact committé qui les porterait ne pourrait
#: jamais passer un gate d'égalité, et une empreinte affichée sur une page que
#: personne ne peut recalculer n'est de toute façon qu'une décoration.
#:
#: Ce qui est publié à leur place est **la propriété**, pas l'empreinte : la chaîne a
#: été vérifiée par `core.audit.verify_chain`, le vrai vérificateur, sur les vraies
#: données, au moment de la capture.
#:
#: `args_hash`, lui, reste : il ne dépend que des arguments, fixés par le scénario. Il
#: est donc stable d'une exécution à l'autre, et il dit exactement ce que le produit
#: revendique — on journalise une empreinte, jamais vos données (`CLAUDE.md` §4.10).
_SEQUENCE_COLONNES = (
    "tool_name",
    "action_class",
    "decision",
    "policy_rule_id",
    "judge_used",
    "args_hash",
    "error",
)


class _GuetteurDeVocabulaire(logging.Handler):
    """Retient les décisions que le récit de conformité ne saurait pas ranger."""

    def __init__(self) -> None:
        super().__init__(level=logging.WARNING)
        self.inconnues: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        if record.getMessage() == "decision_not_summarised":
            self.inconnues.append(str(getattr(record, "decision", "?")))


@pytest.fixture(autouse=True)
def _refuser_une_decision_hors_vocabulaire(request: pytest.FixtureRequest) -> Iterator[None]:
    """Échouer tout test qui écrit une décision d'audit que `summarise` ignore.

    **Pourquoi au point d'écriture et pas dans un inventaire.** Le garde qui existait
    — `_VOCABULARY` dans `tests/test_evidence_claims.py` — était une liste écrite à la
    main, confrontée à `_BUCKETS`, une autre liste écrite à la main. Les deux se
    mettent à jour dans le même geste, donc elles omettent dans le même geste :
    `streamed_uninspected` manquait aux deux depuis son introduction, et la décision
    était comptée dans le total du récit de conformité tout en n'étant rapportée
    nulle part.

    Un scan statique n'aurait pas refermé le trou : les décisions arrivent tantôt en
    littéral, tantôt par une table (`_INTEGRITY_DECISION`), tantôt calculées
    (`f"monitor_{...}"`). Ce garde-ci n'énumère rien — il écoute `log_event`, donc il
    voit exactement ce que le produit écrit, sur les chemins que la suite exerce.

    Il ne casse pas l'écriture elle-même (§4.2) : `log_event` se contente d'avertir,
    et c'est le test qui refuse.
    """
    if request.node.get_closest_marker("vocabulaire_libre"):
        # L'exemption existe pour **un** usage : le test qui prouve que ce garde
        # mord, en écrivant délibérément une décision inconnue. Sans elle, il
        # échouerait par le garde qu'il vérifie.
        yield
        return
    guetteur = _GuetteurDeVocabulaire()
    journal = logging.getLogger("xsom.audit")
    journal.addHandler(guetteur)
    try:
        yield
    finally:
        journal.removeHandler(guetteur)
    if guetteur.inconnues:
        pytest.fail(
            "décisions écrites que `core/export.summarise` ne sait pas ranger : "
            f"{sorted(set(guetteur.inconnues))}\n"
            "  elles seraient comptées dans le total du récit de conformité et\n"
            "  rapportées nulle part. Ajoutez-les à `_BUCKETS` dans core/export.py,\n"
            "  dans la case qui dit la vérité — jamais `auto_allowed` pour du trafic\n"
            "  qu'on n'a pas inspecté."
        )


#: Rempli au démontage de chaque test marqué, relu par `pytest_sessionfinish`.
_sequences: dict[str, dict[str, Any]] = {}


@pytest.fixture(autouse=True)
def _capture_audit_sequence(request: pytest.FixtureRequest) -> Iterator[None]:
    """Capturer la trace d'audit d'un scénario de couverture, pour la rejouer.

    Ne s'active que sur un test portant `@covers` **et** utilisant `db` : demander la
    base à un test qui n'en veut pas lui en ferait payer la création.

    `db` est demandé au montage et pas au démontage, pour que pytest l'enregistre
    comme dépendance : notre finaliseur passe alors avant le sien, et la base existe
    encore quand on la lit.
    """
    if not request.node.get_closest_marker("covers") or "db" not in request.fixturenames:
        yield
        return
    handle = request.getfixturevalue("db")
    yield
    colonnes = ", ".join(_SEQUENCE_COLONNES)
    try:
        rows = handle.conn.execute(
            f"select {colonnes} from audit_log order by id"  # noqa: S608 - liste fermée
        ).fetchall()
        # Le vrai vérificateur, sur les vraies données : il recalcule chaque charge et
        # confronte le chaînage. Écrire « chaînée » sans l'avoir fait vérifier serait
        # exactement la revendication non appuyée que tout ce dépôt refuse.
        chaine = audit.verify_chain(handle.conn)
    except psycopg.Error:
        # Capture en échec doux : une séquence manquante ne doit pas faire rougir un
        # test qui, lui, a prouvé ce qu'il devait. Le générateur la verra absente.
        return
    _sequences[request.node.nodeid] = {
        "chainee": chaine.ok,
        "entrees": [dict(zip(_SEQUENCE_COLONNES, r, strict=True)) for r in rows],
    }


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "covers(row, facet, ingress=..., sens=...): coverage facet this test proves (AD-26)",
    )
    config.addinivalue_line(
        "markers",
        "vocabulaire_libre: ce test écrit délibérément une décision d'audit que "
        "`core/export.summarise` ne sait pas ranger — il prouve le garde, il en est donc "
        "exempté. Aucun autre usage.",
    )
    config.stash[_scenarios_key] = []


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo[None]) -> Any:
    outcome = yield
    report = outcome.get_result()
    if report.when != "call":
        return
    for mark in item.iter_markers(name="covers"):
        if len(mark.args) != 2:
            raise ValueError(f"{item.nodeid}: @covers takes (row, facet)")
        row, facet = mark.args
        sens = mark.kwargs.get("sens")
        if sens not in _SENS:
            raise ValueError(f"{item.nodeid}: @covers needs sens in {sorted(_SENS)}")
        item.config.stash[_scenarios_key].append(
            {
                "row": row,
                "facet": facet,
                "ingress": mark.kwargs.get("ingress"),
                "sens": sens,
                "test": item.nodeid,
                "outcome": report.outcome,
            }
        )


def pytest_sessionfinish(session: pytest.Session) -> None:
    scenarios = session.config.stash.get(_scenarios_key, None)
    if not scenarios:
        return
    _SCENARIOS_OUT.parent.mkdir(parents=True, exist_ok=True)
    _SCENARIOS_OUT.write_text(json.dumps(scenarios, indent=2, sort_keys=True), encoding="utf-8")
    # Écrit à part plutôt qu'ajouté à `.scenarios.json` : ce dernier est le contrat que
    # `scripts/gen_coverage.py` lit, et lui ajouter un champ ferait porter à `CM-7` le
    # risque d'une capture qui n'a rien à voir avec lui.
    _SEQUENCES_OUT.write_text(json.dumps(_sequences, indent=2, sort_keys=True), encoding="utf-8")
