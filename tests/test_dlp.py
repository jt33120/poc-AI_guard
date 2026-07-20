"""Egress data-loss guard: detection, validators, verdicts, redaction."""

from __future__ import annotations

import json

from core import dlp
from core.dlp import Action, Category, DlpPolicy

# Realistic-shaped but fake values (never real credentials).
AWS_KEY = "AKIAIOSFODNN7EXAMPLE"
GITHUB_PAT = "ghp_" + "a" * 36
STRIPE_KEY = "sk_live_" + "b" * 24
OPENAI_KEY = "sk-proj-" + "c" * 32
ANTHROPIC_KEY = "sk-ant-api03-" + "d" * 32
JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV"
PEM = "-----BEGIN PRIVATE KEY-----"
VISA_OK = "4242424242424242"  # Luhn-valid
VISA_BAD = "4242424242424241"  # Luhn-invalid
IBAN_OK = "GB82WEST12345698765432"  # mod-97 valid
IBAN_BAD = "GB00WEST12345698765432"


def _rules(text: str, *, entropy: bool = False) -> set[str]:
    return {f.rule for f in dlp.scan_text(text, entropy=entropy)}


# --- L0 fixed-form secrets ----------------------------------------------------


def test_detects_common_secret_formats() -> None:
    assert "aws_access_key_id" in _rules(f"key={AWS_KEY} rest")
    assert "github_token" in _rules(f"token {GITHUB_PAT}")
    assert "stripe_secret_key" in _rules(f"stripe {STRIPE_KEY}")
    assert "jwt" in _rules(f"bearer {JWT}")
    assert "private_key_pem" in _rules(f"{PEM}\nMIIB...")
    assert "basic_auth_url" in _rules("clone https://user:pass@github.com/x")


def test_anthropic_prefix_wins_over_generic_openai_prefix() -> None:
    # sk-ant-... matches both patterns; dedup must keep the precise label.
    assert _rules(f"key {ANTHROPIC_KEY}") == {"anthropic_key"}
    assert "openai_key" in _rules(f"key {OPENAI_KEY}")


def test_findings_never_carry_the_raw_value() -> None:
    (finding,) = dlp.scan_text(f"key={AWS_KEY}")
    blob = json.dumps(finding.__dict__)
    assert AWS_KEY not in blob
    assert finding.value_sha256 and AWS_KEY not in finding.value_sha256


# --- L2 structured PII (validators) -------------------------------------------


def test_credit_card_requires_luhn() -> None:
    assert "credit_card" in _rules(f"card {VISA_OK}")
    assert "credit_card" not in _rules(f"card {VISA_BAD}")


def test_iban_requires_mod97() -> None:
    assert "iban" in _rules(f"iban {IBAN_OK}")
    assert "iban" not in _rules(f"iban {IBAN_BAD}")


def test_fr_nir_key_validator() -> None:
    # Independent reference: key = 97 - (13-digit body mod 97).
    body = "1801275108001"
    key = 97 - (int(body) % 97)
    valid = f"{body}{key:02d}"
    assert dlp._nir_ok(valid)
    bad = f"{body}{(key + 1) % 100:02d}"
    assert not dlp._nir_ok(bad)
    assert "fr_nir" in _rules(f"nir {valid}")


def test_email_is_pii() -> None:
    findings = dlp.scan_text("write to alice@example.com please")
    assert [f.category for f in findings] == [Category.pii]


# --- L1 entropy (opt-in) ------------------------------------------------------


def test_entropy_flags_unknown_blob_only_when_enabled() -> None:
    blob = "Zx9Qw3Vb7Kp2Lm8Nr4Ts6Uy1Wd5Ef0Gh"  # 33 chars, high entropy, no known prefix
    assert "high_entropy" not in _rules(f"data {blob}")  # off by default
    assert "high_entropy" in _rules(f"data {blob}", entropy=True)


def test_entropy_ignores_uuid_and_hashes() -> None:
    uuid = "550e8400-e29b-41d4-a716-446655440000"
    sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    assert _rules(f"id {uuid} hash {sha256}", entropy=True) == set()


# --- Request-level verdicts ---------------------------------------------------


def _body(text: str) -> bytes:
    return json.dumps({"model": "gpt-4o", "messages": [{"role": "user", "content": text}]}).encode()


def test_secret_blocks_by_default() -> None:
    result = dlp.scan_request(_body(f"my key is {AWS_KEY}"), DlpPolicy())
    assert result.blocked is True
    assert result.redacted_body is None
    assert result.decision == "deny"
    assert "aws_access_key_id" in result.kinds


def test_pii_flags_but_does_not_block_by_default() -> None:
    result = dlp.scan_request(_body("email me at bob@corp.io"), DlpPolicy())
    assert result.blocked is False
    assert result.redacted_body is None  # flag = forward original unchanged
    assert result.decision == "flag"
    assert result.kinds == ["email"]


def test_redact_action_masks_the_value_in_place() -> None:
    policy = DlpPolicy(secret=Action.block, pii=Action.redact)
    result = dlp.scan_request(_body("email bob@corp.io now"), policy)
    assert result.blocked is False
    assert result.redacted_body is not None
    out = result.redacted_body.decode()
    assert "bob@corp.io" not in out
    assert "[REDACTED:email]" in out
    assert json.loads(out)  # still valid JSON after in-place redaction


def test_block_wins_over_redact_when_both_present() -> None:
    policy = DlpPolicy(secret=Action.block, pii=Action.redact)
    result = dlp.scan_request(_body(f"{AWS_KEY} and bob@corp.io"), policy)
    assert result.blocked is True
    assert result.redacted_body is None


def test_disabled_policy_is_a_noop() -> None:
    policy = DlpPolicy(secret=Action.off, pii=Action.off, entropy=Action.off)
    result = dlp.scan_request(_body(f"{AWS_KEY} bob@corp.io"), policy)
    assert result.findings == [] and result.blocked is False


def test_redact_text_leaves_clean_text_untouched() -> None:
    assert dlp.redact_text("nothing here", []) == "nothing here"


def test_digest_is_stable_and_valueless() -> None:
    a = dlp.scan_request(_body(f"k {AWS_KEY}"), DlpPolicy())
    b = dlp.scan_request(_body(f"k {AWS_KEY}"), DlpPolicy())
    assert a.digest() == b.digest()
    assert AWS_KEY not in a.digest()


def test_policy_from_settings_off_when_disabled() -> None:
    class _S:
        dlp_enabled = False
        dlp_secret_action = "block"
        dlp_pii_action = "flag"
        dlp_entropy_action = "off"

    assert dlp.policy_from_settings(_S()).is_active is False
    _S.dlp_enabled = True
    assert dlp.policy_from_settings(_S()).secret is Action.block
