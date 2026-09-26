"""Composition d'un paquet : empreintes des termes, oubli du clair, calcul borné."""

from __future__ import annotations

import base64
import time
from datetime import UTC, datetime
from typing import Any

import pytest

from core import rules_pack_engine as engine
from core import rules_packs

_TENANT = "00000000-0000-4000-8000-000000000001"
_SECRET_TERMS = ["Projet Faucon", "Nébuleuse", "  PROJET faucon "]


def _draft(**overrides: Any) -> rules_packs.PackDraft:
    body: dict[str, Any] = {
        "packId": "acme-main",
        "validityDays": 365,
        "detectors": [
            {
                "id": "acme.customer-id",
                "label": "Identifiant client ACME",
                "category": "customer_data",
                "action": "block",
                "match": {"type": "pattern", "pattern": "CLI-[0-9]{8}"},
            },
            {
                "id": "acme.codenames",
                "label": "Nom de code de projet",
                "category": "project",
                "action": "block",
                "match": {"type": "terms", "terms": _SECRET_TERMS},
            },
        ],
        "tests": {
            "positives": [{"detector": "acme.customer-id", "text": "Client CLI-00421337."}],
            "negatives": ["Le ticket JIRA-12345678 est clos."],
        },
    }
    body.update(overrides)
    return rules_packs.PackDraft.model_validate(body)


def _build(draft: rules_packs.PackDraft, previous: dict[str, Any] | None = None) -> dict[str, Any]:
    return rules_packs.build_payload(
        draft,
        tenant_id=_TENANT,
        version=1,
        previous=previous,
        now=datetime(2026, 9, 26, 12, 30, 45, 123456, tzinfo=UTC),
    )


def test_clear_terms_never_reach_the_signed_bytes() -> None:
    payload = _build(_draft())
    raw = rules_packs.canonical(payload).decode("utf-8").lower()
    for word in ("faucon", "nébuleuse", "nebuleuse"):
        assert word not in raw
    terms = payload["detectors"][1]["match"]
    assert terms["maxWords"] == 2
    # « Projet Faucon » et « PROJET faucon » ont la même forme : une seule empreinte.
    assert len(terms["digests"]) == 2
    assert terms["digests"] == sorted(terms["digests"])
    salt = base64.b64decode(terms["salt"])
    assert engine.term_digest(salt, "projet faucon") in terms["digests"]


def test_the_built_payload_is_valid_and_timestamped_to_the_second() -> None:
    payload = _build(_draft())
    assert payload["issuedAt"] == "2026-09-26T12:30:45Z"
    assert payload["expiresAt"] == "2027-09-26T12:30:45Z"
    assert payload["issuer"] == rules_packs.ISSUER
    rules_packs.validate(payload)


def test_each_build_draws_a_fresh_salt() -> None:
    first = _build(_draft())["detectors"][1]["match"]
    second = _build(_draft())["detectors"][1]["match"]
    assert first["salt"] != second["salt"]
    assert set(first["digests"]).isdisjoint(second["digests"])


def test_published_digests_are_kept_when_terms_are_not_retyped() -> None:
    previous = _build(_draft())
    draft = _draft()
    draft.detectors[1].match = rules_packs.TermsDraft(type="terms", terms=None)
    kept = _build(draft, previous)["detectors"][1]["match"]
    assert kept == previous["detectors"][1]["match"]


def test_terms_are_required_without_a_published_version() -> None:
    draft = _draft()
    draft.detectors[1].match = rules_packs.TermsDraft(type="terms", terms=None)
    with pytest.raises(rules_packs.RulesPackError) as refused:
        _build(draft)
    assert (refused.value.code, refused.value.detector) == ("terms_required", "acme.codenames")


@pytest.mark.parametrize(
    ("term", "code"),
    [("« — »", "term_empty"), ("un deux trois quatre cinq", "term_too_many_words")],
)
def test_unusable_terms_are_refused_without_echoing_them(term: str, code: str) -> None:
    draft = _draft()
    draft.detectors[1].match = rules_packs.TermsDraft(type="terms", terms=[term])
    with pytest.raises(rules_packs.RulesPackError) as refused:
        _build(draft)
    assert refused.value.code == code
    assert term not in str(refused.value) and term not in repr(refused.value.as_dict())


def test_a_catastrophic_pattern_is_refused_within_the_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Valide selon §3, mais ``re`` y passerait des heures : on tue et on refuse."""
    monkeypatch.setattr(rules_packs, "TIMEOUT_SECONDS", 1.5)
    draft = _draft(
        detectors=[
            {
                "id": "slow",
                "label": "Motif lent",
                "category": "internal_infra",
                "action": "warn",
                "match": {
                    "type": "pattern",
                    "pattern": "[a-z]{0,60}[a-z]{0,60}[a-z]{0,60}[a-z]{0,60}XYZ",
                },
            }
        ],
        tests={"positives": [{"detector": "slow", "text": "abcXYZ"}], "negatives": ["a" * 1500]},
    )
    payload = _build(draft)
    started = time.monotonic()
    with pytest.raises(rules_packs.RulesPackError) as refused:
        rules_packs.validate(payload)
    assert refused.value.code == "budget_exceeded"
    assert time.monotonic() - started < 10


def test_an_unreachable_engine_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rules_packs, "_ENGINE", rules_packs._ENGINE.with_name("absent.py"))
    with pytest.raises(rules_packs.RulesPackError) as refused:
        rules_packs.validate(_build(_draft()))
    assert refused.value.code == "engine_failed"


def test_the_sample_is_evaluated_and_positions_are_returned() -> None:
    payload = _build(_draft())
    sample = "Réunion projet-FAUCON, dossier CLI-12345678."
    evaluation = rules_packs.evaluate(payload, sample)
    assert evaluation.error is None
    found = [(d["detector"], sample[d["start"] : d["end"]]) for d in evaluation.detections]
    assert found == [("acme.codenames", "projet-FAUCON"), ("acme.customer-id", "CLI-12345678")]


def test_an_oversized_sample_is_refused() -> None:
    with pytest.raises(rules_packs.RulesPackError) as refused:
        rules_packs.evaluate(_build(_draft()), "x" * (rules_packs.MAX_SAMPLE_CHARS + 1))
    assert refused.value.code == "sample_too_large"


def test_the_draft_repr_never_shows_the_terms() -> None:
    draft = _draft()
    assert "Faucon" not in repr(draft)
    assert "Faucon" not in str(draft)


def test_device_state_reads_the_workstation_claim() -> None:
    digest = "a" * 64
    assert rules_packs.device_state(None, digest, digest) == "up_to_date"
    assert rules_packs.device_state(None, None, digest) == "behind"
    assert rules_packs.device_state(None, "b" * 64, digest) == "behind"
    rejected = {"posture_reasons": ["rules_pack_rejected"]}
    assert rules_packs.device_state(rejected, digest, digest) == "refused"
