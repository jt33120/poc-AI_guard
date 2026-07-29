"""Settings: safe defaults, env overrides, and fail-closed CORS (CLAUDE.md §4.8)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from api.main import create_app
from core.config import Settings

_ENV_EXAMPLE = Path(__file__).resolve().parent.parent / ".env.example"

#: Settings fields deliberately absent from ``.env.example``. Empty today, and
#: it should stay that way: an operator must be able to discover every knob by
#: reading the file they just copied. Add a name here only with a reason.
_UNDOCUMENTED_FIELDS: frozenset[str] = frozenset()

#: Environment variables the product reads WITHOUT going through ``Settings`` —
#: so the field-based check below is blind to them, and each one has already been
#: a shipped deployment defect (D4 was exactly this: a snippet emitting a name
#: nothing reads). Name -> why it exists, kept as documentation for the reader.
_DEPLOYMENT_ENV_VARS: dict[str, str] = {
    "XSOM_TENANT_TOKEN": "gateway/server.py TENANT_TOKEN_ENV — the agent's token",
    "XSOM_ADMIN_PASSWORD": "cli/main.py ADMIN_PASSWORD_ENV — `cli bootstrap --email`",
    "NEXT_PUBLIC_XSOM_API_URL": "baked into the console by `next build`",
    "XSOM_API_PORT": "docker-compose.yml — published control API port",
    "XSOM_DB_PORT": "docker-compose.yml — published database port",
}

#: Deployment variables that must stay COMMENTED OUT in ``.env.example``. A
#: password left as a live key is a password someone leaves in their .env.
_MUST_BE_COMMENTED: frozenset[str] = frozenset({"XSOM_ADMIN_PASSWORD"})


def _parse_env_file(path: Path) -> dict[str, str]:
    """Parse a dotenv file the way an operator reads it: KEY=value, # comments."""
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        values[key.strip()] = value.strip()
    return values


def _parse_commented_keys(path: Path) -> set[str]:
    """Keys documented but deliberately left inactive, i.e. lines like `# KEY=`."""
    keys: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped.startswith("#"):
            continue
        candidate = stripped.lstrip("#").strip()
        key, sep, _ = candidate.partition("=")
        key = key.strip()
        if sep and key and key.replace("_", "").isalnum() and key.isupper():
            keys.add(key)
    return keys


def test_defaults_are_safe() -> None:
    settings = Settings(_env_file=None)
    assert settings.env == "dev"
    assert settings.is_prod is False
    assert settings.docs_enabled is True
    assert settings.cors_allow_origins == []
    assert settings.sentry_dsn is None


def test_prod_disables_docs() -> None:
    settings = Settings(_env_file=None, env="prod")
    assert settings.is_prod is True
    assert settings.docs_enabled is False


def test_cors_origins_split_from_comma_string() -> None:
    settings = Settings(_env_file=None, cors_allow_origins="http://a.com, http://b.com")
    assert settings.cors_allow_origins == ["http://a.com", "http://b.com"]


def test_cors_wildcard_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, cors_allow_origins="*")


def test_prod_app_hides_docs_but_serves_health() -> None:
    app = create_app(Settings(_env_file=None, env="prod"))
    assert app.docs_url is None
    assert app.openapi_url is None
    client = TestClient(app)
    assert client.get("/health").status_code == 200
    assert client.get("/docs").status_code == 404


# ---------------------------------------------------------------------------
# The shipped .env.example must boot. These tests go through the real dotenv
# source: passing values as init kwargs bypasses it, which is exactly why a
# dotenv-only crash (JSON pre-decoding of list[str]) shipped unnoticed.
# ---------------------------------------------------------------------------
def test_shipped_env_example_boots_a_working_server(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`cp .env.example .env` then boot: no SettingsError, CORS parsed, /health up."""
    env_file = tmp_path / ".env"
    env_file.write_text(_ENV_EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
    # The process environment outranks the dotenv source; drop anything the
    # sandbox happens to export so this asserts on the file, not on the host.
    for key in _parse_env_file(_ENV_EXAMPLE):
        monkeypatch.delenv(key, raising=False)

    settings = Settings(_env_file=env_file)

    assert settings.env == "dev"
    assert settings.cors_allow_origins == ["http://localhost:3000"]
    assert settings.docs_enabled is True
    client = TestClient(create_app(settings))
    assert client.get("/health").status_code == 200


def test_every_settings_field_is_documented_in_env_example() -> None:
    """A new setting can never ship undocumented (deployment must stay obvious)."""
    documented = set(_parse_env_file(_ENV_EXAMPLE))
    missing = {
        name.upper()
        for name in Settings.model_fields
        if name not in _UNDOCUMENTED_FIELDS and name.upper() not in documented
    }
    assert not missing, f".env.example is missing: {sorted(missing)}"


def test_deployment_env_vars_are_documented_in_env_example() -> None:
    """Vars read outside Settings are invisible to the check above — pin them here."""
    text = _ENV_EXAMPLE.read_text(encoding="utf-8")
    active = set(_parse_env_file(_ENV_EXAMPLE))
    commented = set(_parse_commented_keys(_ENV_EXAMPLE))
    missing = sorted(name for name in _DEPLOYMENT_ENV_VARS if name not in active | commented)
    assert not missing, f".env.example is missing: {missing}"
    # A name is worthless without the sentence explaining what it unlocks.
    assert "Deployment-time variables" in text


def test_one_shot_secrets_are_commented_out_in_env_example() -> None:
    """`cp .env.example .env` must not leave a password-shaped key sitting live."""
    active = set(_parse_env_file(_ENV_EXAMPLE))
    live = sorted(_MUST_BE_COMMENTED & active)
    assert not live, f"must be commented out in .env.example: {live}"


def test_env_example_carries_no_stale_keys() -> None:
    """Every documented key still exists, so the file cannot rot into fiction."""
    known = {name.upper() for name in Settings.model_fields} | set(_DEPLOYMENT_ENV_VARS)
    stale = sorted(set(_parse_env_file(_ENV_EXAMPLE)) - known)
    assert not stale, f".env.example documents keys nothing reads: {stale}"


def test_cors_origins_from_dotenv_comma_string(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("CORS_ALLOW_ORIGINS=https://a.example, https://b.example\n")
    settings = Settings(_env_file=env_file)
    assert settings.cors_allow_origins == ["https://a.example", "https://b.example"]


def test_cors_origins_from_dotenv_empty_value(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("CORS_ALLOW_ORIGINS=\n")
    settings = Settings(_env_file=env_file)
    assert settings.cors_allow_origins == []


def test_cors_origins_from_dotenv_json_list(tmp_path: Path) -> None:
    """Backward compatibility: deployments already setting a JSON list keep working."""
    env_file = tmp_path / ".env"
    env_file.write_text('CORS_ALLOW_ORIGINS=["https://a.example","https://b.example"]\n')
    settings = Settings(_env_file=env_file)
    assert settings.cors_allow_origins == ["https://a.example", "https://b.example"]


def test_cors_origins_from_dotenv_malformed_json_is_rejected(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text('CORS_ALLOW_ORIGINS=["https://a.example"\n')
    with pytest.raises(ValidationError):
        Settings(_env_file=env_file)


def test_cors_wildcard_from_dotenv_is_rejected(tmp_path: Path) -> None:
    """Fail-closed at boot rather than serving a wildcard CORS policy."""
    env_file = tmp_path / ".env"
    env_file.write_text("CORS_ALLOW_ORIGINS=https://a.example,*\n")
    with pytest.raises(ValidationError):
        Settings(_env_file=env_file)
