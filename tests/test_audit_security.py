"""The static security audit must pass clean on this repo (CLAUDE.md §4/§7)."""

from __future__ import annotations

from scripts import audit_security


def test_no_critical_findings_on_clean_repo() -> None:
    findings = audit_security.run_audit()
    criticals = [f for f in findings if f.severity == audit_security.CRITICAL]
    assert criticals == [], f"unexpected critical findings: {criticals}"


def test_main_returns_zero() -> None:
    assert audit_security.main() == 0
