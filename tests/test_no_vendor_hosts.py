"""No tracked file may point a deployer at the maintainer's own instance.

This is a security property, not tidiness. A vendor hostname baked into a shipped
artifact silently routes someone else's agent traffic — and with it their provider
API keys and their audit trail — through a server they do not control. It has
already happened three times in this repo (a Railway host in the onboarding page,
a Supabase project ref in the deploy guide, a Railway default in a CI workflow),
each time surviving review because nothing failed when it was wrong.

Scanning tracked files rather than the worktree is deliberate: a developer's local
`.env` legitimately holds their own hosts, and only what is committed ships.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parent.parent

#: Hosts and identifiers belonging to the maintainer's deployment. A generic
#: pattern is used for Railway rather than one literal host so a *different*
#: vendor host cannot be introduced by renaming the project.
_VENDOR_PATTERNS: dict[str, re.Pattern[str]] = {
    "maintainer's Supabase project ref": re.compile(r"ahndrprqongfqohkhwfu"),
    "a live Railway hostname": re.compile(r"[A-Za-z0-9-]+\.up\.railway\.app"),
}

#: Files allowed to contain the patterns: this test (it *is* the patterns) and
#: the planning docs, which describe the defects by quoting them.
_EXEMPT: frozenset[str] = frozenset({"tests/test_no_vendor_hosts.py"})
_EXEMPT_PREFIXES: tuple[str, ...] = ("docs/product/",)

#: Env var names the runtime does NOT read. D4: the onboarding wizard emitted
#: `XSOM_GATEWAY_TOKEN` while gateway/server.py reads `XSOM_TENANT_TOKEN`, so the
#: snippet it generated could never work. Shipped artifacts must not name it; the
#: planning docs may, since documenting the mismatch is their job.
_DEAD_ENV_VARS: tuple[str, ...] = ("XSOM_GATEWAY_TOKEN",)


def _tracked_text_files() -> list[str]:
    """Paths git will ship, minus anything that is not decodable text.

    Untracked-but-unignored files are included: a new artifact must be caught in
    the commit that introduces it, not in the one after. ``--exclude-standard``
    keeps a developer's gitignored ``.env`` out, which is the whole point.
    """
    listed = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=_REPO,
        capture_output=True,
        text=True,
        check=True,
    )
    paths = []
    for name in listed.stdout.split("\0"):
        if not name or name in _EXEMPT:
            continue
        try:
            (_REPO / name).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # binary asset or a symlink; nothing to leak
        paths.append(name)
    return paths


@pytest.mark.parametrize(("label", "pattern"), sorted(_VENDOR_PATTERNS.items()))
def test_no_tracked_file_names_a_vendor_host(label: str, pattern: re.Pattern[str]) -> None:
    hits = [
        f"{name}:{line_no}"
        for name in _tracked_text_files()
        if not name.startswith(_EXEMPT_PREFIXES)
        for line_no, line in enumerate((_REPO / name).read_text(encoding="utf-8").splitlines(), 1)
        if pattern.search(line)
    ]
    assert not hits, f"{label} appears in tracked files: {hits}"


@pytest.mark.parametrize("var", _DEAD_ENV_VARS)
def test_shipped_artifacts_do_not_name_an_env_var_nothing_reads(var: str) -> None:
    """A generated snippet exporting the wrong name is worse than no snippet."""
    hits = [
        f"{name}:{line_no}"
        for name in _tracked_text_files()
        if not name.startswith(_EXEMPT_PREFIXES)
        for line_no, line in enumerate((_REPO / name).read_text(encoding="utf-8").splitlines(), 1)
        if var in line
    ]
    assert not hits, f"{var} is read by nothing, but is named in: {hits}"


def test_the_scan_actually_reaches_the_shipped_artifacts() -> None:
    """Guard the guard: an empty or mis-rooted file list would pass everything."""
    tracked = set(_tracked_text_files())
    for required in (".env.example", "docs/DEPLOY.md", "frontend/app/(app)/onboarding/page.tsx"):
        assert required in tracked, f"{required} is not being scanned"
