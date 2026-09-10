"""L'observabilité ne doit rien exfiltrer, et doit exister là où on décide.

Deux défauts opposés vivaient côte à côte, et aucun ne se voyait à la relecture.

**Le premier est une fuite.** `core/observability.py` initialisait Sentry avec
`send_default_pii=False` et affirmait dans son docstring ne jamais expédier de PII.
C'est faux : dans le SDK 2.x, seule la capture des *cookies* dépend de ce drapeau.
Le corps de requête est capturé indépendamment, jusqu'à 10 Ko, et les variables
locales avec. Une exception non gérée sur `/v1/authorize` expédiait donc les
arguments d'outil bruts, et une exception sur `/proxy/*` le prompt du client final
— exactement ce que §4.10 interdit.

**Le second est un silence.** `gateway/server.py` n'appelait ni `configure_logging`
ni `init_observability`. La moitié des points de journalisation du dépôt vivent sur
cette voie, la seule qui soit contraignante, et aucun n'émettait quoi que ce soit :
racine sans handler, niveau `WARNING`, les `logger.info` perdus et les alarmes
sorties nues par `logging.lastResort`, sans tenant ni date.

Les contrôles ci-dessous portent donc sur ce que le code **fait**, pas sur ce qu'il
déclare : les options réellement passées au SDK, les lignes réellement émises, et le
flux sur lequel elles sortent.
"""

from __future__ import annotations

import io
import json
import logging
import sys
from typing import Any

import pytest

from core.config import Settings
from core.logging import JsonFormatter, configure_logging, id_requete
from core.observability import _scrub, init_observability


@pytest.fixture
def options_sentry(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Les options réellement passées à `sentry_sdk.init`, sans réseau."""
    capturees: dict[str, Any] = {}

    import sentry_sdk

    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: capturees.update(kw))
    actif = init_observability(
        Settings(_env_file=None, env="dev", sentry_dsn="https://k@exemple.invalid/1")
    )
    assert actif, "l'initialisation aurait dû se déclencher avec un DSN"
    return capturees


def test_sentry_never_ships_the_request_body(options_sentry: dict[str, Any]) -> None:
    """Le verrou qui ferme la fuite principale.

    `max_request_body_size` vaut `"medium"` par défaut dans le SDK, soit 10 Ko de
    corps expédiés à chaque exception. Sur `/v1/authorize`, ce corps EST
    `payload.arguments`.
    """
    assert options_sentry["max_request_body_size"] == "never"


def test_sentry_never_ships_local_variables(options_sentry: dict[str, Any]) -> None:
    """La même donnée revient par la pile si on ne ferme que le corps.

    Le proxy lit `body: bytes` dans une variable locale : couper le corps sans
    couper les locales déplacerait la fuite d'un champ à l'autre du même événement.
    """
    assert options_sentry["include_local_variables"] is False


def test_the_scrubber_is_installed_and_not_merely_defined(
    options_sentry: dict[str, Any],
) -> None:
    """Une ceinture qu'on oublie de boucler ne tient rien.

    `_scrub` peut être parfait et n'être jamais appelé : ce contrôle vérifie qu'il
    est bien passé au SDK, ce qu'une relecture du fichier ne distingue pas d'un
    `before_send` défini plus bas et laissé inutilisé.
    """
    assert options_sentry["before_send"] is _scrub


def test_the_scrubber_removes_the_body_and_the_token_in_the_url() -> None:
    """Le nettoyeur par défaut du SDK ne regarde jamais l'URL.

    Deux routes du proxy portent le jeton de passerelle **dans le chemin** — c'est
    ce qui permet de pointer n'importe quel SDK dessus sans en-tête. L'URL est donc
    un secret, et elle voyage dans chaque événement.
    """
    evenement: Any = {
        "request": {
            "data": {"tool": "mail.send", "arguments": {"to": "client@exemple.fr"}},
            "url": "https://api.example/proxy/openai/xsg-live-SECRET123/v1/chat/completions",
        }
    }
    nettoye: Any = _scrub(evenement, {})
    assert "data" not in nettoye["request"], "le corps de requête survit au nettoyage"
    assert "SECRET123" not in nettoye["request"]["url"], "le jeton survit dans l'URL"
    assert "<jeton>" in nettoye["request"]["url"]


def test_the_scrubber_survives_an_event_without_a_request() -> None:
    """Un événement hors requête ne doit pas faire échouer l'expédition.

    Un `before_send` qui lève empêche Sentry de rapporter QUOI QUE CE SOIT, y
    compris le plantage qu'on voulait voir. C'est le mode de panne qui coûte le
    plus cher, et il ne se déclenche que le jour où on en a besoin.
    """
    for evenement in ({}, {"request": None}, {"request": {"url": None}}):
        assert _scrub(evenement, {}) is evenement  # type: ignore[arg-type]


def test_logging_writes_to_stderr_because_stdout_carries_the_mcp_protocol(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Le contrôle qui protège le transport de la passerelle.

    La passerelle MCP parle le protocole sur **stdout**. Une seule ligne de journal
    écrite là casse la session, et le message d'erreur côté agent ne dit rien de la
    cause. `StreamHandler()` sans argument vise stderr aujourd'hui — ce test est ce
    qui empêche qu'un changement de défaut, ou un `sys.stdout` explicite ajouté par
    distraction, passe inaperçu.
    """
    configure_logging("INFO")
    logging.getLogger("essai").info("tool_denied", extra={"tool": "mail.send"})
    capture = capsys.readouterr()
    assert capture.out == "", f"une ligne de journal est sortie sur STDOUT : {capture.out!r}"
    assert "tool_denied" in capture.err


def test_the_gateway_runtime_actually_emits_its_decision_logs() -> None:
    """Le silence de la voie contraignante, énoncé comme un test.

    Sans configuration, `logger.info` n'émet **rien** : racine sans handler, niveau
    `WARNING`. Une relecture voit `logger.info("tool_denied", ...)` dans
    `gateway/server.py` et conclut que ça sort. Ce test exécute la préparation que
    `run_stdio` effectue désormais, puis exige une ligne JSON complète — pas
    seulement un message, mais ses métadonnées, puisque c'est ce que
    `logging.lastResort` perdait.
    """
    from gateway.server import prepare_runtime

    # Racine remise à nu AVANT d'appeler la préparation. Sans cette ligne, le test
    # constate la configuration posée par un test précédent du même fichier et passe
    # même si `prepare_runtime` ne fait plus rien : éprouvé par mutation, il ne
    # mordait pas.
    racine = logging.getLogger()
    for pose in list(racine.handlers):
        racine.removeHandler(pose)
    racine.setLevel(logging.WARNING)

    prepare_runtime(Settings(_env_file=None, env="dev", log_level="INFO"))

    tampon = io.StringIO()
    handler = logging.getLogger().handlers[0]
    assert isinstance(handler, logging.StreamHandler), "la préparation n'a posé aucun handler"
    ancien, handler.stream = handler.stream, tampon  # type: ignore[attr-defined]
    try:
        logging.getLogger("gateway.server").info(
            "tool_denied", extra={"tool": "mail.send", "decision": "deny"}
        )
    finally:
        handler.stream = ancien  # type: ignore[attr-defined]

    ligne = json.loads(tampon.getvalue().strip())
    assert ligne["message"] == "tool_denied"
    assert ligne["tool"] == "mail.send"
    assert ligne["decision"] == "deny"
    assert ligne["level"] == "INFO"
    assert ligne["ts"], "sans horodatage, une alarme n'est pas corrélable"


def test_the_request_id_travels_without_being_passed_by_hand() -> None:
    """La corrélation, et pourquoi elle ne passe pas par les sites d'appel.

    Aucun des quarante appels `logger.*` du dépôt ne portait `request_id` : le
    passer à la main aurait garanti qu'on l'oublie au quarante-et-unième. Il
    voyage donc par contexte, et un filtre l'injecte.
    """
    configure_logging("INFO")
    tampon = io.StringIO()
    handler = logging.getLogger().handlers[0]
    ancien, handler.stream = handler.stream, tampon  # type: ignore[attr-defined]
    jeton = id_requete.set("abc123")
    try:
        logging.getLogger("essai").info("tool_relayed", extra={"tool": "mail.send"})
    finally:
        id_requete.reset(jeton)
        handler.stream = ancien  # type: ignore[attr-defined]

    assert json.loads(tampon.getvalue().strip())["request_id"] == "abc123"


def test_a_record_outside_any_request_stays_well_formed() -> None:
    """Le filtre ne doit pas fabriquer un champ vide quand il n'y a rien à dire."""
    configure_logging("INFO")
    tampon = io.StringIO()
    handler = logging.getLogger().handlers[0]
    ancien, handler.stream = handler.stream, tampon  # type: ignore[attr-defined]
    try:
        logging.getLogger("essai").info("demarrage")
    finally:
        handler.stream = ancien  # type: ignore[attr-defined]

    assert "request_id" not in json.loads(tampon.getvalue().strip())


def test_a_refused_gateway_token_is_logged_by_fingerprint_never_in_clear(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Un balayage de jetons ne laissait aucune trace, nulle part.

    Ni journal, ni `audit_log` — ce chemin n'appelle pas `log_event` — ni Sentry,
    puisqu'une `HTTPException` est gérée par FastAPI et n'atteint pas le handler
    d'`api/errors.py`. Le seul indice résiduel était un `last_used_at` immobile.

    Et le contrôle qui compte est le second : l'empreinte suffit à compter les
    tentatives par porteur, le jeton en clair serait un secret dans les journaux
    (§4.7), donc rejouable par quiconque les lit.
    """
    from api.gateway_auth import _refus

    secret = "xsg-live-SECRET123"
    with caplog.at_level(logging.WARNING):
        _refus("rejected", secret)

    enregistrement = next(r for r in caplog.records if r.message == "gateway_auth_refused")
    assert enregistrement.reason == "rejected"  # type: ignore[attr-defined]
    empreinte = enregistrement.token_fp  # type: ignore[attr-defined]
    assert empreinte and secret not in empreinte, "le jeton voyage en clair dans `extra`"

    # Et sur la ligne RÉELLEMENT émise, pas sur `caplog.text` : celui-ci ne rend que
    # le message formaté, jamais les champs `extra`, si bien qu'une assertion écrite
    # dessus est vraie quoi qu'on mette dans `extra`. Éprouvé par mutation.
    rendu = JsonFormatter().format(enregistrement)
    assert secret not in rendu, f"le jeton est sorti en clair : {rendu}"


def test_a_missing_token_is_logged_without_inventing_a_fingerprint() -> None:
    """Pas de jeton, pas d'empreinte : on ne hache pas la chaîne vide.

    Une empreinte de `""` serait une constante, identique pour tous les appels sans
    jeton — elle ressemblerait à un porteur unique qui martèle l'API, et enverrait
    la lecture des journaux dans le mur.
    """
    from api.gateway_auth import _refus

    journal = logging.getLogger("api.gateway_auth")
    captures: list[logging.LogRecord] = []
    handler = logging.Handler()
    handler.emit = captures.append  # type: ignore[method-assign]
    journal.addHandler(handler)
    try:
        _refus("missing", None)
    finally:
        journal.removeHandler(handler)

    assert captures and not hasattr(captures[0], "token_fp")


def test_the_module_docstring_no_longer_promises_what_the_code_did_not_do() -> None:
    """Non-vacuité, et rappel de la faute d'origine.

    Le fichier affirmait « ``send_default_pii`` est forcé à off donc on n'envoie
    jamais de PII à Sentry ». C'est cette phrase, plus que le code, qui a fait que
    personne n'a regardé : elle citait la bonne règle et la mauvaise garantie. Si
    elle revient, ce contrôle la refuse.
    """
    import core.observability as module

    doc = module.__doc__ or ""
    assert "ne suffit pas" in doc, "le docstring ne dit plus pourquoi le drapeau est insuffisant"
    assert sys.modules["core.observability"]._JETON_DANS_URL.pattern  # type: ignore[attr-defined]
