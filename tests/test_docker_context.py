"""The deployment artifacts say what they mean: build context, compose topology.

None of this needs a Docker daemon — these are the properties that were wrong
before and that no runtime test would have caught either: an image that cannot
migrate itself, a port that collides on first run, an API that reports healthy
against an unmigrated database.
"""

from __future__ import annotations

import json
import re
from fnmatch import fnmatch
from pathlib import Path, PurePosixPath
from typing import Any

import pytest
import yaml

_REPO = Path(__file__).resolve().parent.parent
_DOCKERIGNORE = _REPO / ".dockerignore"
_DOCKERFILE = _REPO / "Dockerfile"
_COMPOSE = _REPO / "docker-compose.yml"

# 127.0.0.1:${VAR:-default}:container — loopback-bound and collision-overridable.
_PORT_RE = re.compile(r"^127\.0\.0\.1:\$\{[A-Z_]+:-\d+\}:\d+$")


@pytest.fixture(scope="module")
def compose() -> dict[str, Any]:
    parsed: dict[str, Any] = yaml.safe_load(_COMPOSE.read_text(encoding="utf-8"))
    return parsed


def _patterns() -> list[str]:
    lines = _DOCKERIGNORE.read_text(encoding="utf-8").splitlines()
    return [line.strip() for line in lines if line.strip() and not line.startswith("#")]


def _excluded(relative_path: str) -> bool:
    """True if .dockerignore keeps ``relative_path`` out of the build context."""
    parts = PurePosixPath(relative_path).parts
    prefixes = ["/".join(parts[:i]) for i in range(1, len(parts) + 1)]
    return any(fnmatch(prefix, pattern) for prefix in prefixes for pattern in _patterns())


# ---------------------------------------------------------------------------
# Build context
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "path",
    [
        "supabase/migrations/0001_init_tenancy.sql",
        # `FR-167` : sans le manifeste dans l'image, la vérification de complétude
        # passe à vide et l'image tronquée redevient indétectable.
        "supabase/migrations/MANIFEST.sha256",
        "core/migrate.py",
        "deploy/auth_compat.sql",
        "scripts/audit_security.py",
        "cli/__main__.py",  # need not exist yet; it must not be excluded when it does
        "api/health.py",
    ],
)
def test_image_carries_what_it_needs_to_migrate_and_serve(path: str) -> None:
    assert not _excluded(path)


@pytest.mark.parametrize(
    "path",
    [
        ".env",
        ".env.example",
        ".env.production",
        "tests/fixtures/supabase_auth_shim.sql",
        "frontend/package.json",
        "docs/DEPLOY.md",
        ".git/config",
        ".github/workflows/ci.yml",
        "node_modules/left-pad/index.js",
        ".venv/bin/python",
        "id_rsa",
        "signing.pem",
        "server.key",
    ],
)
def test_image_ships_no_secret_no_test_fixture_no_junk(path: str) -> None:
    assert _excluded(path)


def test_dockerfile_runs_unprivileged_and_serves_the_control_api() -> None:
    body = _DOCKERFILE.read_text(encoding="utf-8")
    assert "USER appuser" in body
    assert "api.main:app" in body


# ---------------------------------------------------------------------------
# Compose topology
# ---------------------------------------------------------------------------
def test_every_published_port_is_loopback_and_overridable(compose: dict[str, Any]) -> None:
    published = [
        port for service in compose["services"].values() for port in service.get("ports", [])
    ]
    assert published, "a stack that publishes nothing cannot be reached"
    for port in published:
        assert _PORT_RE.match(port), f"{port!r} is not 127.0.0.1:${{VAR:-default}}:container"


def test_the_api_cannot_start_before_the_database_is_migrated(compose: dict[str, Any]) -> None:
    depends = compose["services"]["api"]["depends_on"]
    assert depends["db"]["condition"] == "service_healthy"
    assert depends["migrate"]["condition"] == "service_completed_successfully"
    assert compose["services"]["migrate"]["depends_on"]["db"]["condition"] == "service_healthy"


def test_database_is_pinned_healthchecked_and_durable(compose: dict[str, Any]) -> None:
    db = compose["services"]["db"]
    assert db["image"].startswith("postgres:16"), "the major version must be pinned"
    assert db["healthcheck"]["test"], "compose ordering depends on this probe"
    volume = db["volumes"][0].split(":")[0]
    assert volume in compose["volumes"], "the audit chain must live on a named volume"


def test_api_and_migrate_share_one_image(compose: dict[str, Any]) -> None:
    """An API build must never run against a schema produced by another build."""
    services = compose["services"]
    assert services["api"]["image"] == services["migrate"]["image"]
    assert services["api"]["build"] == services["migrate"]["build"] == "."


def test_readiness_is_what_the_api_healthcheck_probes(compose: dict[str, Any]) -> None:
    probe = " ".join(compose["services"]["api"]["healthcheck"]["test"])
    assert "/health/ready" in probe


def test_every_host_path_referenced_by_compose_exists(compose: dict[str, Any]) -> None:
    for service in compose["services"].values():
        for mount in service.get("volumes", []):
            source = mount.split(":")[0]
            if source.startswith("."):
                assert (_REPO / source).exists(), f"{source} is mounted but absent"
        build = service.get("build")
        if build is not None:
            assert (_REPO / build).is_dir()


def test_compose_states_that_it_ships_no_identity_provider(compose: dict[str, Any]) -> None:
    """The honest limitation has to survive future edits to the file."""
    header = _COMPOSE.read_text(encoding="utf-8")
    assert "NO identity provider" in header
    assert "auth" not in compose["services"], "an auth service needs its own story first"


def test_the_deployment_healthcheck_probes_readiness_not_liveness() -> None:
    """La sonde de déploiement ne pouvait pas dire non, et c'est celle qui décide.

    `railway.json` pointait sur `/health`, qui rend `{"status": "ok"}` **en dur**,
    sans toucher ni la base ni les migrations. Un conteneur avec un `DATABASE_URL`
    faux, une base en pause ou des migrations en retard passait donc le contrôle,
    était promu, et restait en rotation : `restartPolicyType: ON_FAILURE` ne se
    déclenche jamais, puisque le processus est parfaitement vivant.

    La sonde qui lit les portes existe — c'est `/health/ready`, et elle n'était
    câblée que dans `docker-compose.yml`. Le contrôle voisin l'exigeait déjà là ;
    celui-ci l'exige là où ça compte.

    **Et ce contrôle-ci ne suffit pas, constaté sur le déploiement réel.** Railway a
    déprécié la configuration par fichier (`railway.json` / `railway.toml`) au profit
    de `.railway/railway.ts` : le fichier de ce dépôt n'est plus lu, et le service de
    production tournait donc avec le défaut du tableau de bord — `/health`, la sonde
    statique, exactement celle que ce test existe pour interdire. Un fichier qui
    déclare une garantie que personne ne lit est pire qu'une absence de fichier :
    il fait croire la question réglée.

    Le fichier est gardé parce qu'il documente l'intention et sert les hôtes qui le
    lisent encore ; ce qui a changé est ce que `docs/DEPLOY.md` en dit — la sonde se
    règle **sur le service**, et le fichier ne la règle pas.
    """
    railway = json.loads((_REPO / "railway.json").read_text(encoding="utf-8"))
    assert railway["deploy"]["healthcheckPath"] == "/health/ready", (
        "le contrôle de déploiement doit interroger la sonde qui peut répondre non ;\n"
        "  `/health` est statique et vert quoi qu'il arrive."
    )
