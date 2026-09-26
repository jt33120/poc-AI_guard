"""« Jamais de token en localStorage » (`CLAUDE.md` §4.5), prouvé sur le code de la console.

La session Supabase ne vit que dans des cookies ``httpOnly`` posés côté serveur ; le
navigateur n'appelle l'API qu'à travers le proxy même-origine, qui attache le jeton.
Ces contrôles lisent le code réel : un client Supabase navigateur, un cookie de session
lisible par JavaScript, un nouvel usage du stockage du navigateur ou un jeton manipulé
dans un composant client font échouer la CI avant d'atteindre un poste.
"""

from __future__ import annotations

import re
from pathlib import Path

_FRONT = Path(__file__).resolve().parent.parent / "frontend"

#: Les seuls écrits dans le stockage du navigateur, et ce qu'ils y mettent.
_STORAGE_ALLOWED = {
    "components/ClientScope.tsx": "l'identifiant du client sélectionné dans la console",
    "design-system/signal.js": "les préférences d'affichage (thème, animations, son)",
}

#: Les modules serveur qui manipulent le jeton d'accès de la session.
_TOKEN_ALLOWED = {"lib/session.ts", "app/api/control/[...path]/route.ts"}

#: Les seuls cookies écrits par JavaScript : une préférence d'affichage, sans autorité.
_JS_COOKIE_ALLOWED = {"lib/i18n.tsx": "xsom_lang, la langue choisie"}


def _sources() -> list[Path]:
    return [
        path
        for pattern in ("*.ts", "*.tsx", "*.js", "*.mjs")
        for path in _FRONT.rglob(pattern)
        if not {"node_modules", ".next", "e2e", "test-results"} & set(path.parts)
        and not path.name.endswith(".config.ts")
    ]


def _relative(path: Path) -> str:
    return path.relative_to(_FRONT).as_posix()


def test_no_supabase_client_runs_in_the_browser() -> None:
    offenders = [_relative(p) for p in _sources() if "createBrowserClient" in p.read_text("utf-8")]
    assert offenders == []


def test_every_session_cookie_writer_forces_httponly() -> None:
    """Chaque ``set`` de cookie de session applique les options après celles de Supabase."""
    for name in ("lib/supabaseServer.ts", "proxy.ts"):
        text = (_FRONT / name).read_text("utf-8")
        assert "setAll" in text, name
        assert re.search(r"httpOnly:\s*true", text), name
        assert re.search(r'sameSite:\s*"lax"', text), name
        assert 'secure: process.env.NODE_ENV === "production"' in text, name
        calls = re.findall(r"cookies\.set\(|store\.set\(", text)
        assert calls, name
        # L'étalement des options de Supabase vient d'abord ; les nôtres l'écrasent.
        for call in re.finditer(r"(?:cookies|store)\.set\(([^;]*?)\);", text, re.DOTALL):
            body = call.group(1)
            assert "...options" in body, (name, body)
            assert body.index("...options") < max(body.find("httpOnly"), body.find("HTTP_ONLY")), (
                name,
                body,
            )


def test_browser_storage_holds_no_session() -> None:
    writers = {
        _relative(p)
        for p in _sources()
        if re.search(
            r"\b(?:localStorage|sessionStorage)\s*(?:\.setItem\(|\[)|\bindexedDB\b",
            p.read_text("utf-8"),
        )
    }
    assert writers <= set(_STORAGE_ALLOWED), sorted(writers - set(_STORAGE_ALLOWED))


def test_no_script_writes_a_session_cookie() -> None:
    writers = {
        _relative(p) for p in _sources() if re.search(r"document\.cookie\s*=", p.read_text("utf-8"))
    }
    assert writers <= set(_JS_COOKIE_ALLOWED), sorted(writers - set(_JS_COOKIE_ALLOWED))
    for name in _JS_COOKIE_ALLOWED:
        for line in (_FRONT / name).read_text("utf-8").splitlines():
            if re.search(r"document\.cookie\s*=", line):
                assert "LANG_COOKIE" in line and "token" not in line.lower(), line


def test_the_access_token_never_reaches_a_client_component() -> None:
    holders = {
        _relative(p)
        for p in _sources()
        if re.search(r"accessToken|\.access_token\b|refresh_token", p.read_text("utf-8"))
    }
    assert holders, "le contrôle ne lit plus rien : le jeton a changé de nom ?"
    assert holders <= _TOKEN_ALLOWED, sorted(holders - _TOKEN_ALLOWED)
    for name in _TOKEN_ALLOWED:
        assert not (_FRONT / name).read_text("utf-8").lstrip().startswith('"use client"')
