#!/usr/bin/env python3
"""Static security audit for xSOM AI Guard (CLAUDE.md §4, §7).

Fail-closed gate: prints findings and exits non-zero if any **CRITICAL** is
found. Warnings are informational and never fail the build. The check set grows
with the codebase (RLS coverage in M1, audit immutability in M5, ...).

stdlib only — runnable in CI without installing the project.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

CRITICAL = "CRITICAL"
WARNING = "WARNING"

# Directories never worth scanning.
_SKIP_DIRS = frozenset(
    {
        ".git",
        ".venv",
        "venv",
        "node_modules",
        "__pycache__",
        ".mypy_cache",
        ".ruff_cache",
        ".pytest_cache",
        ".next",
        "htmlcov",
        "dist",
        "build",
    }
)
_CODE_SUFFIXES = frozenset({".py", ".ts", ".tsx", ".js", ".jsx", ".yaml", ".yml", ".json", ".toml"})
# Files exempt from content-pattern checks: the scanner itself necessarily
# embeds example signatures, and .env.example documents config keys.
_CONTENT_SCAN_EXCLUDE = frozenset({"scripts/audit_security.py", ".env.example"})


@dataclass(frozen=True)
class Finding:
    severity: str
    code: str
    message: str


def _rel(path: Path) -> str:
    return str(path.relative_to(REPO))


def _iter_files() -> list[Path]:
    files: list[Path] = []
    for path in REPO.rglob("*"):
        if path.is_dir():
            continue
        if any(part in _SKIP_DIRS for part in path.relative_to(REPO).parts):
            continue
        files.append(path)
    return files


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return ""


def _iter_code_files() -> list[Path]:
    """Code files scanned for dangerous patterns (excludes the scanner itself)."""
    return [
        p
        for p in _iter_files()
        if p.suffix in _CODE_SUFFIXES and _rel(p) not in _CONTENT_SCAN_EXCLUDE
    ]


def check_env_gitignored(findings: list[Finding]) -> None:
    text = _read(REPO / ".gitignore")
    if not re.search(r"(?m)^\s*\.env\s*$", text):
        findings.append(
            Finding(CRITICAL, "ENV_NOT_IGNORED", ".env is not gitignored (CLAUDE.md §4.7)")
        )


def check_env_not_tracked(findings: list[Finding]) -> None:
    result = subprocess.run(
        ["git", "ls-files"],  # noqa: S607
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    for line in result.stdout.splitlines():
        name = line.strip()
        if name == ".env" or name.endswith("/.env"):
            findings.append(
                Finding(CRITICAL, "ENV_TRACKED", f"{name} is tracked by git (CLAUDE.md §4.7)")
            )


def check_cors_wildcard(findings: list[Finding]) -> None:
    pattern = re.compile(r"""allow_origins\s*=\s*\[\s*["']\*["']""")
    for path in _iter_code_files():
        if path.suffix == ".py" and pattern.search(_read(path)):
            findings.append(
                Finding(
                    CRITICAL,
                    "CORS_WILDCARD",
                    f"wildcard CORS origin in {_rel(path)} (CLAUDE.md §4.8)",
                )
            )


def check_debug_true(findings: list[Finding]) -> None:
    pattern = re.compile(r"FastAPI\([^)]*\bdebug\s*=\s*True", re.DOTALL)
    for path in _iter_code_files():
        if path.suffix == ".py" and pattern.search(_read(path)):
            findings.append(
                Finding(
                    CRITICAL, "DEBUG_TRUE", f"FastAPI(debug=True) in {_rel(path)} (CLAUDE.md §4.8)"
                )
            )


def check_committed_secrets(findings: list[Finding]) -> None:
    # Heuristic: a service-role / secret variable assigned a long literal value.
    pattern = re.compile(
        r"""(?i)(service_role|secret_key|api_key|access_token|password)\s*[=:]\s*["']?[A-Za-z0-9._\-]{20,}"""
    )
    for path in _iter_code_files():
        if pattern.search(_read(path)):
            findings.append(
                Finding(
                    CRITICAL,
                    "POSSIBLE_SECRET",
                    f"possible hardcoded secret in {_rel(path)} (CLAUDE.md §4.7)",
                )
            )


def check_docs_gated(findings: list[Finding]) -> None:
    main = _read(REPO / "api" / "main.py")
    if main and "docs_enabled" not in main:
        findings.append(
            Finding(
                WARNING, "DOCS_NOT_GATED", "api/main.py does not gate /docs by env (CLAUDE.md §4.8)"
            )
        )


def check_rls_migrations(findings: list[Finding]) -> None:
    migrations = REPO / "supabase" / "migrations"
    sql = list(migrations.glob("*.sql")) if migrations.exists() else []
    if not sql:
        findings.append(
            Finding(WARNING, "NO_MIGRATIONS", "no SQL migrations yet (RLS lands in M1)")
        )
        return
    if not any("enable row level security" in _read(p).lower() for p in sql):
        findings.append(
            Finding(CRITICAL, "NO_RLS", "migrations exist but none enable RLS (CLAUDE.md §4.3)")
        )


CHECKS = (
    check_env_gitignored,
    check_env_not_tracked,
    check_cors_wildcard,
    check_debug_true,
    check_committed_secrets,
    check_docs_gated,
    check_rls_migrations,
)


def run_audit() -> list[Finding]:
    findings: list[Finding] = []
    for check in CHECKS:
        check(findings)
    return findings


def main() -> int:
    findings = run_audit()
    criticals = [f for f in findings if f.severity == CRITICAL]
    warnings = [f for f in findings if f.severity == WARNING]

    for finding in findings:
        print(f"[{finding.severity}] {finding.code}: {finding.message}")

    print(f"\naudit_security: {len(criticals)} critical, {len(warnings)} warning(s)")
    if criticals:
        print("audit_security: FAILED (critical findings)")
        return 2
    print("audit_security: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
