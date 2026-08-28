"""FR-182 / FR-183 / AD-31 — the demonstration tenant, and what guards it.

`AD-31`'s rule is that the demo tenant ships as reviewable fixtures rather than
generator output, so "no third-party personal data" is verified by reading the
diff — and that a CI check fails on any seed value matching a real-PII shape.

The check uses `core/dlp.py`, the product's own detectors. Two reasons, and the
second is the one that matters: a second set of patterns would drift from the
first, and the day they disagree is the day the product detects something in a
customer's traffic that it tolerates in its own shop window.
"""

from __future__ import annotations

import re
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import yaml

from core import audit, dlp
from tests.conftest import DBHandle

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import seed_demo

_REPO = Path(__file__).resolve().parents[1]
_FIXTURE = _REPO / "demo" / "seed.yaml"

#: RFC 2606 reserves these for documentation. An address outside them in a demo
#: fixture is either someone's real address or a domain someone really owns.
_RESERVED_SUFFIXES = (
    "@example.com",
    "@example.org",
    "@example.net",
    ".example",
    ".invalid",
    ".test",
)


def _all_text(node: object) -> list[str]:
    """Every string anywhere in the fixture. A nested value is still a value."""
    if isinstance(node, str):
        return [node]
    if isinstance(node, dict):
        return [t for v in node.values() for t in _all_text(v)]
    if isinstance(node, list):
        return [t for v in node for t in _all_text(v)]
    return []


def test_the_fixture_carries_no_real_pii_shape() -> None:
    """The check AD-31 asks for, run with the detectors the product sells.

    An IBAN that passes its checksum, a social-security number whose key is right,
    a card that satisfies Luhn: none of those is a value someone fabricated by
    accident. They are real data that slipped in.
    """
    offenders: list[str] = []
    for text in _all_text(yaml.safe_load(_FIXTURE.read_text(encoding="utf-8"))):
        for finding in dlp.scan_text(text):
            if finding.category is not dlp.Category.pii:
                continue
            if finding.rule == "email":
                continue  # judged separately, below
            offenders.append(f"{finding.rule} in {text[:60]!r}")
    assert not offenders, (
        f"real-PII shapes in demo/seed.yaml: {offenders}. A validated IBAN, NIR or "
        "card number is not a fabrication slip — it is real data. Remove the value; "
        "the fixture needs none of them."
    )


def test_every_address_in_the_fixture_is_a_reserved_one() -> None:
    """Emails are allowed, but only where nobody can receive the mail."""
    stray = [
        finding.value_sha256[:12]
        for text in _all_text(yaml.safe_load(_FIXTURE.read_text(encoding="utf-8")))
        for finding in dlp.scan_text(text)
        if finding.rule == "email" and not any(s in text.lower() for s in _RESERVED_SUFFIXES)
    ]
    assert not stray, (
        "an address outside the RFC 2606 reserved domains is in the demo fixture "
        f"(hashes: {stray}). It is someone's address, or a domain someone owns."
    )


def test_the_seeder_is_never_reachable_from_the_running_product() -> None:
    """The guard that makes a dated audit write acceptable at all.

    `seed_demo` chooses `ts`, which is inside the hashed payload. That is the same
    power the server's clock already has — but it must stay an operator tool. If an
    adapter could reach it, the product would ship a supported way to write history.
    """
    # An *import*, not a mention: `core/audit.py` names the seeder in a comment
    # explaining why `payload_v1` is public, and a naive substring search flagged
    # that on the first run. A gate whose failures are prose is a gate people learn
    # to ignore.
    importing = re.compile(r"^\s*(?:from|import)\s+\S*\bseed_demo\b", re.MULTILINE)
    importers = [
        str(path.relative_to(_REPO))
        for directory in ("core", "api", "gateway")
        for path in (_REPO / directory).rglob("*.py")
        if importing.search(path.read_text(encoding="utf-8"))
    ]
    assert not importers, (
        f"{importers} reference the demo seeder. Writing an audit entry with a chosen "
        "timestamp is an operator action, not a product capability."
    )


def test_the_seeder_refuses_production() -> None:
    with pytest.raises(seed_demo.SeedRefused, match="ENV=prod"):
        seed_demo.seed("postgresql://unused", env="prod")


def test_the_seeded_history_verifies_like_real_history(db: DBHandle) -> None:
    """A seed the chain rejects would be a demo that fails its own `verify_chain`.

    This is the assertion that makes the whole approach honest: the fixture is not
    written *around* the integrity check, it satisfies it.
    """
    written = seed_demo.seed(db.url, env="dev")
    assert written["events"] > 100  # ten days of activity, not a handful
    assert written["windows"] == 1

    result = audit.verify_chain(db.conn, written["tenant_id"])
    assert result.ok and result.count == written["events"]


def test_the_history_actually_spans_days(db: DBHandle) -> None:
    """FR-183 — "accumulated" means a series, not a spike at load time.

    A seed that wrote everything at `now` would render as one bar on every timeline
    in the console, which is the opposite of "continuous supervision is legible".
    """
    written = seed_demo.seed(db.url, env="dev")
    row = db.conn.execute(
        "select min(ts), max(ts) from audit_log where tenant_id = %s", (written["tenant_id"],)
    ).fetchone()
    assert row is not None
    span = row[1] - row[0]
    assert span > timedelta(days=8), f"the seeded history spans only {span}"
    assert row[1] < datetime.now(UTC) + timedelta(minutes=1)  # nothing dated in the future


def test_the_seed_gives_the_promotion_report_something_to_show(db: DBHandle) -> None:
    """The observation window exists so FR-180 is demonstrable without opening one."""
    from core import promotion

    written = seed_demo.seed(db.url, env="dev")
    report = promotion.build_report(db.conn, tenant_id=written["tenant_id"])
    assert report.windows == 1
    assert report.has_data and report.held > 0
    assert report.window_still_open is False  # a closed period reads as a verdict
