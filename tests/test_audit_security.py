"""The static security audit must pass clean on this repo (CLAUDE.md §4/§7)."""

from __future__ import annotations

from pathlib import Path

import pytest

from scripts import audit_security


def test_no_critical_findings_on_clean_repo() -> None:
    findings = audit_security.run_audit()
    criticals = [f for f in findings if f.severity == audit_security.CRITICAL]
    assert criticals == [], f"unexpected critical findings: {criticals}"


def test_main_returns_zero() -> None:
    assert audit_security.main() == 0


def test_secret_check_scans_tests_but_allows_fragmented_fixtures(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    test_dir = tmp_path / "tests"
    test_dir.mkdir()
    (test_dir / "literal.test.ts").write_text(
        "const value = 'PASSWORD=\"actual-looking-secret-123456\"';",
        encoding="utf-8",
    )
    (test_dir / "synthetic.test.ts").write_text(
        "const value = ['PASSWORD=\"process', \"env\", 'PASSWORD\"'].join('.');",
        encoding="utf-8",
    )
    monkeypatch.setattr(audit_security, "REPO", tmp_path)

    findings: list[audit_security.Finding] = []
    audit_security.check_committed_secrets(findings)

    assert len(findings) == 1
    assert findings[0].code == "POSSIBLE_SECRET"
    assert "tests/literal.test.ts" in findings[0].message
