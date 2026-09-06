"""Le parse de policy, mémoïsé — et pourquoi le partage est sûr.

`EXH-9` prévient qu'une passerelle en ligne sans chiffre de surcoût publié sera
rejetée sur cette seule base. En allant chercher ce chiffre, le premier constat n'a
pas été une latence à publier mais un **défaut à corriger** : `api/authorize.py` et
`api/llm_proxy.py` re-analysaient le document de policy à chaque requête, là où la
passerelle MCP le charge une fois par session.

Ces tests tiennent les deux moitiés de la correction : le travail n'est plus refait,
et l'objet désormais partagé entre requêtes ne peut pas être muté — sans quoi le cache
transformerait une optimisation en fuite d'un tenant vers le suivant.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from core import policy_store
from core.policy import Approval, parse_policy
from core.policy_store import DEFAULT_POLICY_YAML
from tests.conftest import DBHandle

_AUTRE = """\
tools:
  - name: mail.send
    class: external_send
    approval: human_in_the_loop
defaults:
  unknown_tool: deny
  hitl_timeout_seconds: 3600
  on_approval_service_down: deny
"""


@pytest.fixture(autouse=True)
def _cache_propre() -> None:
    """Chaque test part d'un cache vide : sinon l'ordre des tests décide du résultat."""
    policy_store._parse_cached.cache_clear()


def test_the_same_document_is_parsed_once() -> None:
    """Le coeur de la correction : le travail n'est pas refait."""
    a = policy_store._parse_cached(DEFAULT_POLICY_YAML)
    b = policy_store._parse_cached(DEFAULT_POLICY_YAML)
    assert a is b
    assert policy_store._parse_cached.cache_info().hits == 1


def test_two_documents_never_share_a_policy() -> None:
    """La moitié qui empêche le cache d'être une fuite entre tenants.

    La clé est le **texte** du document, pas le tenant : deux policies différentes
    sont deux clés, et un document modifié est un texte différent. Il n'existe donc
    aucun instant où le cache peut être en retard sur la base.
    """
    defaut = policy_store._parse_cached(DEFAULT_POLICY_YAML)
    autre = policy_store._parse_cached(_AUTRE)
    assert defaut is not autre
    assert autre.rule_for("mail.send") is not None
    assert defaut.rule_for("mail.send") is None


def test_a_policy_cannot_be_mutated() -> None:
    """Ce qui **autorise** le partage, et sans quoi le cache serait un défaut.

    Un objet partagé entre requêtes et muté par l'une d'elles porterait la policy
    d'un tenant dans la décision du suivant. `frozen=True` fait lever la tentative
    au lieu de la laisser réussir en silence.
    """
    policy = parse_policy(_AUTRE)
    with pytest.raises(ValidationError):
        policy.defaults.unknown_tool = Approval.auto  # type: ignore[misc]
    with pytest.raises(ValidationError):
        policy.tools[0].approval = Approval.auto  # type: ignore[misc]


def test_a_broken_document_is_not_cached() -> None:
    """Mémoïser une levée transformerait une erreur passagère en panne durable."""
    for _ in range(2):
        with pytest.raises(ValueError):
            policy_store._parse_cached("tools: [{name: x}]\n")
    assert policy_store._parse_cached.cache_info().hits == 0


def test_the_cache_is_bounded() -> None:
    """Un cache sans plafond est une fuite qu'un client multi-tenant finit par trouver."""
    assert policy_store._parse_cached.cache_info().maxsize == policy_store.PARSE_CACHE_SIZE


# ---------------------------------------------------------------------------
# Sur le site qui portait le défaut
# ---------------------------------------------------------------------------
def test_two_authorize_requests_parse_the_policy_once(
    db: DBHandle, monkeypatch: pytest.MonkeyPatch
) -> None:
    """La preuve au bon endroit : le chemin coopératif, deux fois de suite.

    Le test compte les parses réels plutôt que de chronométrer : un seuil de temps
    flotterait sur un exécuteur partagé, un compteur non. Sans le cache il vaut 2.
    """
    tid = str(uuid4())
    db.conn.execute("insert into tenants (id, name) values (%s, 'P')", (tid,))
    db.conn.commit()

    parses = 0
    vrai_parse = parse_policy

    def compte(text: str) -> object:
        nonlocal parses
        parses += 1
        return vrai_parse(text)

    monkeypatch.setattr(policy_store, "parse_policy", compte)

    for _ in range(2):
        policy_store.load_policy(db.conn, tid)

    assert parses == 1, "le document est ré-analysé à chaque requête"
