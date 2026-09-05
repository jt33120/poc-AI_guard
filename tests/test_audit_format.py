"""`FR-171` — la représentation canonique est figée, et prouvée par des vecteurs dorés.

Le piège de ce test est explicite, parce qu'il est le seul qui compte : si l'attendu
était **calculé** en appelant `payload_v1` ou `canonical_ts`, le test encoderait sa
propre réponse et resterait vert sous n'importe quel changement de format. Les valeurs
ci-dessous sont des constantes tapées dans le fichier, capturées une fois depuis le
code, et elles ne doivent jamais être recalculées.

Ce que cela garde : `audit_log` est append-only, donc une entrée écrite hier ne peut
pas être corrigée. Un changement *cohérent* du format — normaliser `+00:00` en `Z`,
figer les microsecondes, changer les `separators`, renommer une clé — laisse toute la
suite verte (elle écrit et vérifie dans le même processus) pendant que la chaîne déjà
en base devient définitivement invérifiable. C'est le seul défaut de ce lot dont le
symptôme n'apparaît qu'en production, sur des lignes qu'on ne peut plus réparer.

Le contrat lisible est `docs/AUDIT_FORMAT.md` ; ce fichier en est la sanction.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from core import audit

_FIELDS = {
    "tenant_id": "t",
    "user_id": None,
    "request_id": "r2",
    "tool_name": "crm.delete",
    "action_class": "irreversible",
    "decision": "deny",
    "policy_rule_id": None,
    "judge_used": False,
    "args_hash": None,
    "latency_ms": None,
    "error": None,
}

#: Capturé depuis le code, figé ici. Ne jamais recalculer.
_PAYLOAD_ZERO_US = (
    '{"action_class":"irreversible","args_hash":null,"decision":"deny","error":null,'
    '"judge_used":false,"latency_ms":null,"policy_rule_id":null,"request_id":"r2",'
    '"tenant_id":"t","tool_name":"crm.delete","ts":"2026-01-02T03:04:05+00:00",'
    '"user_id":null}'
)
_HASH_ZERO_US = "a8292209624a69a5454ec516e364c2cc2e89db4af2246da0febdddcb65114d98"

_PAYLOAD_SUB_US = (
    '{"action_class":"irreversible","args_hash":null,"decision":"deny","error":null,'
    '"judge_used":false,"latency_ms":null,"policy_rule_id":null,"request_id":"r2",'
    '"tenant_id":"t","tool_name":"crm.delete","ts":"2026-01-02T03:04:05.123456+00:00",'
    '"user_id":null}'
)
_HASH_SUB_US = "72e13669e4b67dbeaff2e28a3f0cc2dac4d991a8635dc3bbf85fa50d0c59a09c"


@pytest.mark.parametrize(
    ("microsecond", "expected_payload", "expected_hash"),
    [
        (0, _PAYLOAD_ZERO_US, _HASH_ZERO_US),
        (123456, _PAYLOAD_SUB_US, _HASH_SUB_US),
    ],
)
def test_the_canonical_payload_and_hash_are_frozen(
    microsecond: int, expected_payload: str, expected_hash: str
) -> None:
    """Les deux cas que `isoformat()` traite différemment, épinglés tous les deux.

    Un seul vecteur aurait laissé passer `timespec="microseconds"`, qui n'a d'effet
    que sur celui à microsecondes nulles.
    """
    at = datetime(2026, 1, 2, 3, 4, 5, microsecond, tzinfo=UTC)
    payload = audit.payload_v1(ts_iso=audit.canonical_ts(at), **_FIELDS)  # type: ignore[arg-type]
    assert payload == expected_payload
    assert audit.compute_entry_hash(audit.GENESIS, payload) == expected_hash


def test_a_zero_microsecond_timestamp_has_no_fractional_part() -> None:
    """La propriété qui surprend, nommée pour qu'on ne la « corrige » pas.

    `isoformat()` omet la partie fractionnaire quand elle est nulle : la longueur de
    la chaîne n'est donc pas constante. C'est le comportement figé, pas un bug.
    """
    at = datetime(2026, 1, 2, 3, 4, 5, 0, tzinfo=UTC)
    assert audit.canonical_ts(at) == "2026-01-02T03:04:05+00:00"
    assert audit.canonical_ts(at.replace(microsecond=1)) == "2026-01-02T03:04:05.000001+00:00"


def test_the_suffix_is_an_offset_never_a_z() -> None:
    """`Z` et `+00:00` désignent le même instant et hachent différemment."""
    at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    assert audit.canonical_ts(at).endswith("+00:00")
    assert "Z" not in audit.canonical_ts(at)


def test_a_non_utc_timestamp_is_normalised_not_rejected() -> None:
    """Le même instant écrit dans un autre fuseau produit les mêmes octets."""
    from datetime import timedelta, timezone

    paris = timezone(timedelta(hours=2))
    assert audit.canonical_ts(datetime(2026, 1, 2, 5, 4, 5, tzinfo=paris)) == (
        "2026-01-02T03:04:05+00:00"
    )


def test_a_naive_timestamp_is_refused() -> None:
    """Supposer UTC produirait une entrée fausse *et* vérifiable — le pire des deux."""
    with pytest.raises(ValueError, match="timezone-aware"):
        audit.canonical_ts(datetime(2026, 1, 2, 3, 4, 5))  # le naïf est le sujet du test
