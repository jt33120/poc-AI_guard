"""Deterministic risk scoring + band mapping (M11)."""

from __future__ import annotations

from core import risk
from core.policy import ActionClass, Approval
from core.risk import RiskBands

_AWS_KEY = "AKIAIOSFODNN7EXAMPLE"


# --- risk_score --------------------------------------------------------------
def test_base_score_tracks_reversibility() -> None:
    assert risk.risk_score(ActionClass.read, {"q": "hi"}, seen_before=True) == 5
    assert risk.risk_score(ActionClass.write, {}, seen_before=True) == 25
    assert risk.risk_score(ActionClass.external_send, {"subject": "hi"}, seen_before=True) == 55
    assert risk.risk_score(ActionClass.irreversible, {}, seen_before=True) == 75


def test_novelty_adds_risk() -> None:
    assert risk.risk_score(ActionClass.read, {}, seen_before=False) == 15
    assert risk.risk_score(ActionClass.read, {}, seen_before=True) == 5


def test_blast_radius_scales_with_targets() -> None:
    assert risk.risk_score(ActionClass.write, {"ids": ["1", "2", "3"]}, seen_before=True) == 35
    assert risk.risk_score(ActionClass.write, {"to": "*"}, seen_before=True) == 40  # wildcard


def test_sensitivity_flags_secrets_and_pii() -> None:
    assert risk.risk_score(ActionClass.write, {"key": _AWS_KEY}, seen_before=True) == 50  # +25
    assert (
        risk.risk_score(ActionClass.write, {"note": "x@y.com"}, seen_before=True) == 45
    )  # pii+blast


def test_score_is_capped_at_100() -> None:
    score = risk.risk_score(
        ActionClass.irreversible, {"key": _AWS_KEY, "to": "*"}, seen_before=False
    )
    assert score == 100  # 75 + 15 + 25 + 10, clamped


# --- band mapping ------------------------------------------------------------
def test_band_maps_score_to_tier() -> None:
    bands = RiskBands()
    assert risk.band(10, bands) is Approval.auto
    assert risk.band(45, bands) is Approval.notify
    assert risk.band(70, bands) is Approval.human_in_the_loop
    assert risk.band(90, bands) is Approval.deny


def test_irreversible_is_never_auto_or_notify() -> None:
    bands = RiskBands()
    # Even a low score cannot let an irreversible action run without a human.
    assert risk.band(10, bands, ActionClass.irreversible) is Approval.human_in_the_loop
    assert risk.band(45, bands, ActionClass.irreversible) is Approval.human_in_the_loop
    # A high score still denies.
    assert risk.band(90, bands, ActionClass.irreversible) is Approval.deny


# --- trust discount + escalate_by_risk ---------------------------------------
def test_trust_discount_kicks_in_at_threshold() -> None:
    assert risk.trust_discount(4) == 0
    assert risk.trust_discount(5) == 30


def test_escalate_only_tightens_an_auto_outcome() -> None:
    bands = RiskBands()
    # A fresh write (25 + 10 novelty = 35) is tightened auto -> notify.
    assert (
        risk.escalate_by_risk(
            Approval.auto, ActionClass.write, {}, bands, seen_before=False, clean_streak=0
        )
        is Approval.notify
    )
    # A stricter base is never touched; no bands = no-op.
    assert (
        risk.escalate_by_risk(
            Approval.human_in_the_loop,
            ActionClass.write,
            {},
            bands,
            seen_before=False,
            clean_streak=0,
        )
        is Approval.human_in_the_loop
    )
    assert (
        risk.escalate_by_risk(
            Approval.auto,
            ActionClass.write,
            {"key": _AWS_KEY},
            None,
            seen_before=False,
            clean_streak=0,
        )
        is Approval.auto
    )


def test_earned_trust_keeps_a_repeat_action_auto() -> None:
    bands = RiskBands()
    args = {"key": _AWS_KEY}  # write + secret = 50 -> notify when untrusted
    assert (
        risk.escalate_by_risk(
            Approval.auto, ActionClass.write, args, bands, seen_before=True, clean_streak=0
        )
        is Approval.notify
    )
    # After a clean streak, the 30-pt discount drops 50 -> 20 -> back to auto.
    assert (
        risk.escalate_by_risk(
            Approval.auto, ActionClass.write, args, bands, seen_before=True, clean_streak=5
        )
        is Approval.auto
    )


def test_earned_trust_cannot_unlock_irreversible() -> None:
    bands = RiskBands()
    # Max trust on an irreversible action still floors to human review.
    assert (
        risk.escalate_by_risk(
            Approval.auto, ActionClass.irreversible, {}, bands, seen_before=True, clean_streak=99
        )
        is Approval.human_in_the_loop
    )
