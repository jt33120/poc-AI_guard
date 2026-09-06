"""Operator CLI: deploy, provision and diagnose a deployment without writing SQL.

Invoked as ``python -m cli <command>``. It lives in an importable package rather
than in ``scripts/`` on purpose: ``.dockerignore`` excludes ``scripts/``, so an
image that shipped its tooling there could not migrate or diagnose itself.

Every command is fail-closed and answers in fixes, not tracebacks: an unreachable
database, a partially migrated schema or an unconfigured capability prints one
actionable line and exits non-zero. The only secret ever printed is a freshly
minted gateway token, shown exactly once because only its SHA-256 hash is stored
(CLAUDE.md §4.7) — nothing is logged and nothing is written to disk.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import socket
import sys
import textwrap
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from uuid import UUID

import psycopg
from pydantic import ValidationError
from pydantic_settings import SettingsError

from core import db, migrate, secrets, shadow_ai, signup, tenant_tokens, triage
from core.config import Settings, get_settings
from core.notify import SmtpNotifier, build_notifier
from core.schemas import SignupRequest

_PUBLISHED_MAP = Path(__file__).resolve().parents[1] / "coverage" / "map.json"

_MODE_LABEL = {
    "B": "Bloqué",
    "D": "Détecté",
    "O": "Orchestré",
    "A": "Attesté",
    "X": "Hors périmètre",
    "NA": "non asserté",
}

#: Environment variable carrying the console admin password for ``bootstrap``.
#: Never a command-line flag: argv is world-readable in ``ps`` and is kept by the
#: shell's history file.
ADMIN_PASSWORD_ENV = "XSOM_ADMIN_PASSWORD"  # noqa: S105 - variable name, not a secret

#: Same bound as the API schemas (``SignupRequest.org``, ``GatewayTokenCreate.name``).
_MAX_NAME = 80

#: What an absent ``supabase/migrations`` means, and how to get it back. A
#: deployment built without it *looks* healthy — nothing is pending because
#: nothing is visible — so both the runner and the diagnostic refuse rather than
#: trust an empty plan.
_NO_MIGRATIONS_FIX = (
    "the deployment must ship supabase/migrations next to the code — check "
    ".dockerignore if this is a container."
)

_Level = Literal["OK", "WARN", "FAIL"]


class CliError(Exception):
    """An operator-facing failure. Printed as-is; never accompanied by a traceback."""


@dataclass(frozen=True)
class Check:
    """One ``doctor`` line: a verdict, what it means, and how to fix it."""

    level: _Level
    code: str
    message: str
    fix: str = ""


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _reason(exc: Exception) -> str:
    """The first line of a driver error — enough to act on, never a stack trace."""
    text = str(exc).strip()
    return text.splitlines()[0] if text else exc.__class__.__name__


def _bounded(value: str, label: str, limit: int) -> str:
    """Bound an operator-supplied string the way the API bounds its own input."""
    cleaned = value.strip()
    if not cleaned or len(cleaned) > limit:
        raise CliError(f"--{label} must be between 1 and {limit} characters")
    return cleaned


def _uuid(value: str, label: str) -> str:
    """Validate an id early, so a typo is a clear error and not a database fault."""
    try:
        return str(UUID(value.strip()))
    except ValueError:
        raise CliError(f"--{label} must be a UUID (got {value!r})") from None


def _database_url(settings: Settings) -> str:
    if not settings.database_url:
        raise CliError(
            "DATABASE_URL is not set, so there is nothing to talk to.\n"
            "  fix: copy .env.example to .env and set DATABASE_URL "
            "(Supabase: Project settings > Database > Connection string)."
        )
    return settings.database_url


@contextmanager
def _connect(settings: Settings) -> Iterator[psycopg.Connection]:
    """Open the operator connection, or raise an actionable error (fail-closed)."""
    url = _database_url(settings)
    try:
        conn = db.connect(url)
    except psycopg.Error as exc:
        raise CliError(
            f"database unreachable: {_reason(exc)}\n"
            "  fix: check DATABASE_URL — host, port, credentials, and that this "
            "deployment is allowed to reach the database."
        ) from None
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def _db_errors(what: str) -> Iterator[None]:
    """Turn a driver failure during ``what`` into one actionable line.

    The common first-run mistake is provisioning before migrating, which surfaces
    as ``UndefinedTable`` — an operator should read the fix, not the SQLSTATE.
    """
    try:
        yield
    except psycopg.errors.UndefinedTable:
        raise CliError(
            f"{what}: the schema is not installed on this database.\n"
            "  fix: run `python -m cli migrate` first."
        ) from None
    except psycopg.errors.ForeignKeyViolation:
        raise CliError(
            f"{what}: that tenant does not exist.\n"
            "  fix: check the tenant id, or provision one with `python -m cli bootstrap`."
        ) from None
    except psycopg.Error as exc:
        raise CliError(f"{what}: {_reason(exc)}") from None


@contextmanager
def _migration_errors() -> Iterator[None]:
    """Translate runner failures into one actionable line."""
    try:
        yield
    except migrate.ChecksumDrift as exc:
        raise CliError(
            f"{exc}\n"
            "  fix: restore the file to the exact content that was applied. A released "
            "migration is never edited; a change ships as a new file."
        ) from None
    except migrate.IncompleteMigrations as exc:
        raise CliError(
            f"{exc}\n"
            "  fix: run this against a complete checkout or image — the migrations "
            "directory shipped incomplete. Check .dockerignore and the COPY layer."
        ) from None
    except migrate.MixedBaseline as exc:
        raise CliError(
            f"{exc}\n"
            "  fix: bring the database to a state this runner can explain (apply the "
            "missing files by hand, or restore a backup), then re-run."
        ) from None
    except migrate.MigrationError as exc:
        # La classe de base, catchée après ses filles : sans cette clause un refus
        # nouveau (le fichier baseline absent du disque) sortirait en traceback.
        raise CliError(str(exc)) from None
    except psycopg.Error as exc:
        raise CliError(
            f"migration failed, nothing was left half-applied: {_reason(exc)}\n"
            "  fix: if this database predates the migration ledger, adopt its history "
            "first with `python -m cli migrate --adopt-baseline`."
        ) from None


def _guard_destructive(settings: Settings, args: argparse.Namespace, what: str) -> None:
    """Refuse a drop/reset/revoke in production unless the operator insists.

    Production is where an accidental keystroke costs the most, so the fast path
    is the safe one: the flag must be typed out every time (Story 1.17).
    """
    if settings.is_prod and not args.yes_i_know:
        raise CliError(
            f"refusing to {what}: ENV=prod and this operation is destructive.\n"
            "  fix: re-run with --yes-i-know if that is really what you want."
        )


def _print_token(raw: str) -> None:
    """Print a freshly minted gateway token — the one and only time it can be read."""
    print()
    print("  gateway token (shown ONCE — only its SHA-256 hash is stored, so it")
    print("  cannot be recovered or re-displayed):")
    print()
    print(f"      {raw}")
    print()
    print("  give it to the agent as XSOM_TENANT_TOKEN and store it in a secret manager")
    print("  now. Lost it? Revoke it (`python -m cli token revoke`) and mint a new one.")


# ---------------------------------------------------------------------------
# migrate
# ---------------------------------------------------------------------------
def cmd_migrate(settings: Settings, args: argparse.Namespace) -> int:
    """Apply pending migrations (or print the plan, or adopt a pre-ledger history)."""
    if not migrate.MIGRATIONS_DIR.is_dir():
        raise CliError(
            f"no migration files at {migrate.MIGRATIONS_DIR}.\n  fix: {_NO_MIGRATIONS_FIX}"
        )
    with _connect(settings) as conn, _migration_errors():
        if args.adopt_baseline:
            adopted = migrate.adopt_baseline(conn)
            if not adopted:
                print("adopt-baseline: nothing to adopt (no pre-ledger history detected)")
            else:
                print(f"adopt-baseline: recorded {len(adopted)} migration(s) as already applied")
                for name in adopted:
                    print(f"  = {name}")
            return 0

        names = migrate.apply_all(conn, dry_run=args.dry_run)
        if args.dry_run:
            print(f"migrate --dry-run: {len(names)} migration(s) would be applied")
        elif names:
            print(f"migrate: applied {len(names)} migration(s)")
        else:
            print("migrate: schema already up to date")
        for name in names:
            print(f"  + {name}")
    return 0


# ---------------------------------------------------------------------------
# bootstrap
# ---------------------------------------------------------------------------
def _admin_password() -> str:
    """Read the console admin password from the environment, else prompt on the TTY."""
    from_env = os.environ.get(ADMIN_PASSWORD_ENV)
    if from_env:
        return from_env
    if not sys.stdin.isatty():
        raise CliError(
            f"no password available: {ADMIN_PASSWORD_ENV} is unset and there is no TTY to "
            "prompt on.\n"
            f"  fix: export {ADMIN_PASSWORD_ENV} for this one command (it is never stored, "
            "logged, or echoed)."
        )
    return getpass.getpass("console admin password: ")


def _create_tenant(conn: psycopg.Connection, org: str) -> str:
    """Insert the tenant alone — the half of provisioning that needs no auth service."""
    row = conn.execute("insert into tenants (name) values (%s) returning id", (org,)).fetchone()
    if row is None:  # pragma: no cover - INSERT ... RETURNING always yields a row
        raise CliError("tenant insert returned no row")
    conn.commit()
    return str(row[0])


def _provision_with_admin(
    conn: psycopg.Connection, admin: signup.AuthAdmin, *, org: str, email: str
) -> str:
    """Create the auth user + tenant + admin membership through the signup flow."""
    try:
        payload = SignupRequest(org=org, email=email, password=_admin_password())
    except ValidationError as exc:
        raise CliError(f"invalid admin account: {exc.errors()[0]['msg']}") from None
    try:
        account = signup.provision_account(
            conn, admin, org=payload.org, email=payload.email, password=payload.password
        )
    except signup.AccountExists:
        raise CliError(
            f"an account already exists for {payload.email}.\n"
            "  fix: sign in with it, or bootstrap with a different --email."
        ) from None
    except signup.SignupError:
        raise CliError(
            "could not provision the account; the partial account was rolled back.\n"
            "  fix: check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, then run "
            "`python -m cli doctor`."
        ) from None
    return account["tenant_id"]


def cmd_bootstrap(settings: Settings, args: argparse.Namespace) -> int:
    """Provision a tenant, its first admin and a gateway token — zero SQL."""
    org = _bounded(args.org, "org", _MAX_NAME)
    token_name = _bounded(args.token_name, "token-name", _MAX_NAME)
    admin = signup.build_auth_admin(settings)
    if args.email and admin is None:
        raise CliError(
            "--email creates a console login, which needs the Supabase admin API: "
            "SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are unset.\n"
            "  fix: set both in .env (the service-role key is backend-only — never the "
            "frontend, never committed), or drop --email to provision the tenant and its "
            "gateway token alone."
        )

    with _connect(settings) as conn, _db_errors("could not provision the tenant"):
        if args.email and admin is not None:
            tenant_id = _provision_with_admin(conn, admin, org=org, email=args.email)
        else:
            tenant_id = _create_tenant(conn, org)
        raw, view = tenant_tokens.mint(conn, tenant_id=tenant_id, name=token_name)

    print(f"tenant    {tenant_id}  ({org})")
    if args.email:
        print(f"admin     {args.email.strip().lower()}  (role=admin) — sign in to the console")
    else:
        print("admin     none — SUPABASE_SERVICE_ROLE_KEY is unset, so no console login was")
        print("          created. The gateway below already enforces policy; this tenant is")
        print("          simply not browsable yet.")
        print("          fix: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and re-run bootstrap")
        print("          with --email (it provisions its own tenant).")
    print(f"token     {view['id']}  ({token_name})")
    _print_token(raw)
    return 0


# ---------------------------------------------------------------------------
# token
# ---------------------------------------------------------------------------
def cmd_token(settings: Settings, args: argparse.Namespace) -> int:
    """Gateway-token lifecycle: mint, list, revoke."""
    tenant_id = _uuid(args.tenant, "tenant")
    if args.action == "revoke":
        _guard_destructive(settings, args, "revoke a gateway token")

    with _connect(settings) as conn, _db_errors(f"token {args.action} failed"):
        if args.action == "mint":
            name = _bounded(args.name, "name", _MAX_NAME)
            raw, view = tenant_tokens.mint(conn, tenant_id=tenant_id, name=name)
            print(f"token     {view['id']}  ({name})")
            _print_token(raw)
            return 0

        if args.action == "list":
            tokens = tenant_tokens.list_tokens(conn, tenant_id)
            if not tokens:
                print(f"no gateway token for tenant {tenant_id}")
                return 0
            for token in tokens:
                state = "revoked" if token["revoked_at"] else "active"
                last = token["last_used_at"] or "never used"
                print(f"{token['id']}  {state:8}  {token['created_at']}  {last}  {token['name']}")
            return 0

        # revoke
        if not tenant_tokens.revoke(conn, tenant_id, _uuid(args.id, "id")):
            raise CliError(
                f"no active token {args.id} for tenant {tenant_id}.\n"
                "  fix: it may already be revoked, or belong to another tenant — check "
                "`python -m cli token list --tenant ...`."
            )
        print(f"revoked   {args.id}  (sessions using it are refused from now on)")
    return 0


# ---------------------------------------------------------------------------
# doctor
# ---------------------------------------------------------------------------
def _check_schema(conn: psycopg.Connection) -> list[Check]:
    """Is the database at head, and does its recorded history still match the tree?"""
    if not migrate.MIGRATIONS_DIR.is_dir():
        return [
            Check(
                "FAIL",
                "schema.source",
                f"no migration files at {migrate.MIGRATIONS_DIR}",
                _NO_MIGRATIONS_FIX,
            )
        ]
    try:
        drifted = migrate.verify_integrity(conn)
        outstanding = [path.name for path in migrate.pending(conn)]
        recorded = migrate.applied(conn)
    except psycopg.Error as exc:
        return [
            Check(
                "FAIL",
                "schema.readable",
                f"cannot read the migration state: {_reason(exc)}",
                "the connection role needs read access to public.schema_migrations.",
            )
        ]

    checks: list[Check] = []
    if drifted:
        checks.append(
            Check(
                "FAIL",
                "schema.integrity",
                f"applied migrations changed on disk: {', '.join(drifted)}",
                "restore them byte for byte; a released migration is never edited.",
            )
        )
    if not outstanding:
        checks.append(
            Check("OK", "schema.pending", f"at head ({len(recorded)} migration(s) applied)")
        )
    elif not recorded:
        checks.append(
            Check(
                "FAIL",
                "schema.pending",
                f"no recorded migration history, {len(outstanding)} file(s) unaccounted for",
                "empty database: `python -m cli migrate`. Database created before the "
                "ledger existed: `python -m cli migrate --adopt-baseline` first.",
            )
        )
    else:
        checks.append(
            Check(
                "FAIL",
                "schema.pending",
                f"{len(outstanding)} migration(s) pending: {', '.join(outstanding)}",
                "run `python -m cli migrate`.",
            )
        )
    return checks


def _check_database(settings: Settings) -> list[Check]:
    if not settings.database_url:
        return [
            Check(
                "FAIL",
                "db.url",
                "DATABASE_URL is unset — the gateway and the control API refuse to start",
                "set DATABASE_URL in .env (see .env.example).",
            )
        ]
    try:
        with db.connection(settings.database_url) as conn:
            conn.execute("select 1")
            return [Check("OK", "db.reachable", "connected"), *_check_schema(conn)]
    except psycopg.Error as exc:
        return [
            Check(
                "FAIL",
                "db.reachable",
                f"cannot query the database: {_reason(exc)}",
                "check DATABASE_URL — host, port, credentials, network reachability.",
            )
        ]


def _check_capabilities(settings: Settings) -> list[Check]:
    """What is switched on, what is off, and what being off actually costs."""
    checks: list[Check] = []

    if settings.jwks_url:
        checks.append(Check("OK", "cap.auth", "Supabase JWT verification configured"))
    else:
        checks.append(
            Check(
                "FAIL" if settings.is_prod else "WARN",
                "cap.auth",
                "SUPABASE_URL unset: every authenticated endpoint rejects its caller "
                "(/health still serves)",
                "set SUPABASE_URL so the console and the API can authenticate.",
            )
        )

    if settings.supabase_service_role_key and settings.supabase_url:
        checks.append(Check("OK", "cap.signup", "POST /v1/signup enabled"))
    else:
        checks.append(
            Check(
                "WARN",
                "cap.signup",
                "self-serve signup disabled: POST /v1/signup answers 503",
                "set SUPABASE_SERVICE_ROLE_KEY (backend-only) to enable it. "
                "`python -m cli bootstrap` still provisions a tenant + gateway token.",
            )
        )

    if settings.mistral_api_key:
        checks.append(Check("OK", "cap.judge", f"LLM judge enabled ({settings.mistral_model})"))
    else:
        checks.append(
            Check(
                "WARN",
                "cap.judge",
                "LLM judge disabled: ambiguous tools are treated as irreversible "
                "(fail-closed, safe but stricter)",
                "set MISTRAL_API_KEY to let the judge classify ambiguous tools.",
            )
        )

    if settings.dlp_enabled:
        checks.append(
            Check(
                "OK",
                "cap.dlp",
                f"egress DLP on (secrets={settings.dlp_secret_action}, "
                f"pii={settings.dlp_pii_action}, entropy={settings.dlp_entropy_action})",
            )
        )
    else:
        checks.append(
            Check(
                "WARN",
                "cap.dlp",
                "egress DLP off: prompts leaving through the LLM proxy are not scanned "
                "for secrets or PII",
                "set DLP_ENABLED=true to scan them.",
            )
        )

    if isinstance(build_notifier(settings), SmtpNotifier):
        checks.append(Check("OK", "cap.notify", "approval emails enabled"))
    else:
        checks.append(
            Check(
                "WARN",
                "cap.notify",
                "approval notifications off: nobody is emailed when an action is held "
                "(it still blocks and waits in the console)",
                "set SMTP_HOST, SMTP_FROM and APPROVAL_NOTIFY_TO.",
            )
        )

    try:
        # Constructing the provider is the check: it validates the key material
        # without touching a stored credential.
        secrets.build_key_provider(settings)
    except secrets.SecretsError as exc:
        configured = bool(settings.secrets_kms_provider)
        checks.append(
            Check(
                "FAIL" if configured else "WARN",
                "cap.secrets",
                f"credential store fails closed: {_reason(exc)}",
                "set SECRETS_KMS_PROVIDER=aws with AWS_KMS_KEY_ID (production), or "
                "SECRETS_KMS_PROVIDER=local with SECRETS_LOCAL_KEK (dev only).",
            )
        )
    else:
        checks.append(
            Check(
                "OK",
                "cap.secrets",
                f"credential store ready (KMS provider: {settings.secrets_kms_provider})",
            )
        )
    return checks


def _check_hardening(settings: Settings) -> list[Check]:
    """Production posture (CLAUDE.md §4.8): docs closed, CORS explicit."""
    checks: list[Check] = []
    if settings.is_prod:
        checks.append(Check("OK", "prod.docs", "/docs, /redoc and /openapi.json are disabled"))
    else:
        checks.append(
            Check(
                "OK",
                "prod.docs",
                f"ENV={settings.env}: /docs is served and the local secrets provider is "
                "allowed — set ENV=prod before exposing this deployment",
            )
        )

    origins = settings.cors_allow_origins
    if origins:
        checks.append(
            Check("OK", "prod.cors", f"explicit CORS allowlist ({len(origins)} origin(s))")
        )
    else:
        checks.append(
            Check(
                "FAIL" if settings.is_prod else "WARN",
                "prod.cors",
                "CORS allowlist empty: no browser origin may call this API",
                "set CORS_ALLOW_ORIGINS to the console URL (comma-separated; '*' is "
                "rejected at load).",
            )
        )
    return checks


def _check_forwarded_allow_ips() -> list[Check]:
    """Le compartiment de limitation des routes publiques dépend de cette variable.

    Les routes authentifiées comptent sur le jeton présenté (`api/ratelimit.py`) et se
    passent de toute configuration. Les routes publiques — inscription, triage, relevé —
    n'ont que l'adresse, et derrière un edge uvicorn ne la réécrit depuis
    `X-Forwarded-For` que si le pair immédiat figure dans `FORWARDED_ALLOW_IPS`, dont le
    défaut est `127.0.0.1`.

    Non renseignée derrière un edge, ces routes partagent **un seul compartiment** : un
    visiteur met la limite en 429 pour tous les autres. Réglée à `*`, c'est l'inverse et
    c'est pire — le `X-Forwarded-For` de n'importe qui est cru, et il suffit d'en changer
    à chaque requête pour n'être jamais limité.

    Le contrôle nomme les deux, parce qu'une limite qu'on croit avoir est plus dangereuse
    qu'une limite absente.
    """
    valeur = (os.environ.get("FORWARDED_ALLOW_IPS") or "").strip()
    if not valeur:
        return [
            Check(
                "WARN",
                "ratelimit.forwarded",
                "FORWARDED_ALLOW_IPS non renseignée : uvicorn ne fait confiance qu'à "
                "127.0.0.1, donc derrière un edge les routes publiques partagent un "
                "seul compartiment de limitation",
                "réglez-la sur l'adresse de votre edge. Les routes authentifiées ne "
                "sont pas concernées : elles comptent sur le jeton présenté.",
            )
        ]
    if "*" in valeur:
        return [
            Check(
                "FAIL",
                "ratelimit.forwarded",
                f"FORWARDED_ALLOW_IPS={valeur!r} fait confiance au X-Forwarded-For de "
                "n'importe quel appelant : la limite des routes publiques se contourne "
                "en changeant un en-tête",
                "nommez l'adresse de votre edge plutôt que '*'.",
            )
        ]
    return [Check("OK", "ratelimit.forwarded", f"edge de confiance déclaré ({valeur})")]


def _check_ports() -> list[Check]:
    """`DEP-10` : nommer une collision de port comme un échec diagnosticable.

    C'est la cause unique la plus fréquente d'un premier lancement raté, et jusqu'ici
    l'opérateur ne voyait que le message de Docker. Le paramétrage seul ne suffisait
    pas : encore faut-il que le diagnostic dise *lequel* est pris et *quoi* écrire
    dans le `.env` — c'est la seconde phrase du correctif que `DEP-10` demandait.

    La sonde est un `bind` sur la boucle locale, pas une connexion : elle répond à la
    question qui compte (« ce port est-il libre pour `docker compose up` ? ») sans
    parler à quoi que ce soit.
    """
    checks: list[Check] = []
    for variable, service, defaut in (
        ("XSOM_API_PORT", "control API", 8000),
        ("XSOM_DB_PORT", "database", 5432),
    ):
        brut = os.environ.get(variable, "")
        try:
            port = int(brut) if brut else defaut
        except ValueError:
            checks.append(
                Check(
                    "FAIL",
                    f"ports.{variable.lower()}",
                    f"{variable}={brut!r} is not a port number",
                    f"set {variable} to an integer between 1 and 65535, or unset it "
                    f"to use {defaut}.",
                )
            )
            continue
        if _port_is_free(port):
            checks.append(
                Check("OK", f"ports.{variable.lower()}", f"{port} is free for the {service}")
            )
        else:
            checks.append(
                Check(
                    "FAIL",
                    f"ports.{variable.lower()}",
                    f"port {port} is already in use, so the {service} cannot start",
                    f"another process holds 127.0.0.1:{port}. Put {variable}=<free port> "
                    f"in your .env — never edit docker-compose.yml — then re-run "
                    f"`make up`.",
                )
            )
    return checks


def _port_is_free(port: int) -> bool:
    """Vrai si `docker compose` pourrait publier ce port sur la boucle locale."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sonde:
        sonde.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sonde.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def cmd_doctor(settings: Settings, args: argparse.Namespace) -> int:
    """Diagnose the deployment; exit non-zero when something is actually broken."""
    del args  # doctor takes no options: it must be safe to run with no thought
    checks = [
        *_check_database(settings),
        *_check_capabilities(settings),
        *_check_hardening(settings),
        *_check_forwarded_allow_ips(),
        *_check_ports(),
    ]
    for check in checks:
        print(f"[{check.level:<4}] {check.code}: {check.message}")
        if check.fix and check.level != "OK":
            print(f"         fix: {check.fix}")

    failures = sum(1 for c in checks if c.level == "FAIL")
    warnings = sum(1 for c in checks if c.level == "WARN")
    passed = len(checks) - failures - warnings
    print(f"\ndoctor: {passed} ok, {warnings} warning(s), {failures} failure(s)")
    if failures:
        print("doctor: BROKEN — fix the FAIL lines above")
        return 1
    print("doctor: healthy")
    return 0


def cmd_triage(settings: Settings, args: argparse.Namespace) -> int:
    """Position a client on the usage profiles and print what actually concerns them.

    Takes no database and no settings: the diagnostic is a conversation held in
    front of a prospect, not a query against their deployment.
    """
    del settings
    try:
        held = triage.parse_profiles(args.profils)
    except ValueError as exc:
        print(f"triage: {exc}", file=sys.stderr)
        return 2
    carte = Path(args.carte) if args.carte else _PUBLISHED_MAP
    try:
        report = triage.diagnose(carte, held)
    except triage.MapUnavailable as exc:
        print(f"triage: {exc}", file=sys.stderr)
        return 1

    held_labels = ", ".join(f"{p.value} ({p.label})" for p in sorted(held, key=lambda p: p.value))
    print(f"Profil retenu : {held_labels}\n")
    print(textwrap.fill(report.statement(), width=88))

    print("\nCe qui vous concerne")
    for line in report.applicable:
        # The owner is printed on applicable lines too: "phishing concerns you, and
        # reception belongs to your mail gateway" is a more useful sentence than a
        # row of `Hors périmètre` with no explanation of whose scope it is in.
        print(f"  {line.id}  {line.titre}  —  {line.owner}")
        for facette in line.facets:
            print(f"        {facette.libelle} : {_MODE_LABEL[facette.mode]}")

    if report.not_applicable:
        print("\nCe qui ne vous concerne pas, et qui le porte")
        for line in report.not_applicable:
            print(f"  {line.id}  {line.titre}")
            print(f"        {line.owner}")
    return 0


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    """The command surface. Kept flat: an operator should not have to explore it."""
    parser = argparse.ArgumentParser(
        prog="python -m cli",
        description=(
            "xSOM AI Guard — operator commands (migrate, bootstrap, token, doctor, triage)."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    migrate_cmd = sub.add_parser("migrate", help="apply pending schema migrations")
    mode = migrate_cmd.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="print the plan, change nothing")
    mode.add_argument(
        "--adopt-baseline",
        action="store_true",
        help="record history for a database migrated by hand before the ledger existed",
    )

    bootstrap_cmd = sub.add_parser(
        "bootstrap", help="provision a tenant, its first admin and a gateway token"
    )
    bootstrap_cmd.add_argument("--org", required=True, help="customer / organisation name")
    bootstrap_cmd.add_argument(
        "--email",
        help=f"console admin login; needs SUPABASE_SERVICE_ROLE_KEY and {ADMIN_PASSWORD_ENV}",
    )
    bootstrap_cmd.add_argument("--token-name", default="default", help="label for the token")

    token_cmd = sub.add_parser("token", help="gateway-token lifecycle")
    token_sub = token_cmd.add_subparsers(dest="action", required=True)
    mint_cmd = token_sub.add_parser("mint", help="mint a token (printed once)")
    mint_cmd.add_argument("--tenant", required=True)
    mint_cmd.add_argument("--name", default="default")
    list_cmd = token_sub.add_parser("list", help="list a tenant's tokens (metadata only)")
    list_cmd.add_argument("--tenant", required=True)
    revoke_cmd = token_sub.add_parser("revoke", help="revoke a token (destructive)")
    revoke_cmd.add_argument("--tenant", required=True)
    revoke_cmd.add_argument("--id", required=True, help="token id from `token list`")
    revoke_cmd.add_argument(
        "--yes-i-know", action="store_true", help="required to revoke when ENV=prod"
    )

    sub.add_parser("doctor", help="diagnose this deployment and print what to fix")

    triage_cmd = sub.add_parser(
        "triage", help="position a client on the usage profiles and print what concerns them"
    )
    triage_cmd.add_argument(
        "--profils",
        required=True,
        help=(
            "comma-separated usage profiles, e.g. P1a,P2,P3 "
            "(see docs/product/THREAT-COVERAGE.md §2.2)"
        ),
    )
    triage_cmd.add_argument(
        "--carte",
        help="published coverage map to quote (default: coverage/map.json in this checkout)",
    )

    shadow = sub.add_parser(
        "shadow-ai",
        help="derive the Shadow AI inventory from a local egress extract (the file stays here)",
    )
    shadow.add_argument(
        "extrait", help="CSV `host,requests,actor_hash` produced by the client's own SOC"
    )
    shadow.add_argument(
        "--supervises",
        help="comma-separated hosts already routed through xSOM (everything else is shadow)",
    )
    return parser


def cmd_shadow_ai(settings: Settings, args: argparse.Namespace) -> int:
    """Dériver l'inventaire du Shadow AI depuis un extrait local, et l'imprimer.

    **Le fichier ne quitte pas ce poste.** C'est la raison d'être de cette commande :
    le parsing et la classification tournent ici, et seul l'inventaire agrégé est
    ensuite déposé par `PUT /v1/shadow-ai`. Le jour où le produit irait chercher ce
    journal lui-même — un connecteur vers un proxy, une tâche périodique, une route
    qui accepte le fichier — il serait devenu le CASB que `QO-3` a refusé.

    L'extrait attendu est minimal, une ligne par couple (hôte, poste) :
    `host,requests,actor_hash`. L'empreinte est produite par le client : l'inventaire
    dit « combien de postes », jamais « lesquels ».
    """
    del settings
    chemin = Path(args.extrait)
    if not chemin.is_file():
        raise CliError(f"extrait introuvable : {chemin}")
    lignes = [ligne for ligne in chemin.read_text(encoding="utf-8").splitlines() if ligne.strip()]
    observations, rejets = shadow_ai.parse_observations(lignes)
    supervises = frozenset(
        h.strip().lower() for h in (args.supervises or "").split(",") if h.strip()
    )
    inventaire = shadow_ai.classify(observations, supervised_hosts=supervises, rejected=rejets)

    print(f"Lignes lues : {len(observations)} · rejetées : {rejets}")
    print(f"Hôtes non classés : {inventaire.unclassified}")
    print("\nSupervisé")
    for service, acteurs in inventaire.supervised.items() or {"(aucun)": 0}.items():
        print(f"  {service} : {acteurs} poste(s)")
    print("\nShadow AI — usages qu'aucune supervision ne couvre")
    for service, acteurs in inventaire.shadow.items() or {"(aucun)": 0}.items():
        print(f"  {service} : {acteurs} poste(s)")
    print(
        "\nÀ déposer via PUT /v1/shadow-ai (seul cet inventaire agrégé traverse le "
        "réseau ; l'extrait reste ici) :"
    )
    print(
        json.dumps(
            {
                "supervised": inventaire.supervised,
                "shadow": inventaire.shadow,
                "unclassified": inventaire.unclassified,
                "rejected": inventaire.rejected,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


_COMMANDS = {
    "migrate": cmd_migrate,
    "bootstrap": cmd_bootstrap,
    "token": cmd_token,
    "doctor": cmd_doctor,
    "triage": cmd_triage,
    "shadow-ai": cmd_shadow_ai,
}


def _load_settings() -> Settings:
    """Load settings, turning a bad ``.env`` into an actionable message."""
    try:
        return get_settings()
    except ValidationError as exc:
        details = "\n".join(
            f"  {'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in exc.errors()
        )
        raise CliError(
            f"invalid configuration:\n{details}\n  fix: compare .env with .env.example."
        ) from None
    except SettingsError as exc:
        raise CliError(
            f"invalid configuration: {_reason(exc)}\n  fix: compare .env with .env.example."
        ) from None


def main(argv: Sequence[str] | None = None, *, settings: Settings | None = None) -> int:
    """Parse, dispatch, and turn any expected failure into one actionable line."""
    args = build_parser().parse_args(argv)
    try:
        resolved = settings or _load_settings()
        return _COMMANDS[args.command](resolved, args)
    except CliError as exc:
        print(f"xsom: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:  # pragma: no cover - interactive only
        print("xsom: interrupted", file=sys.stderr)
        return 130
