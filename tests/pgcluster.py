"""Ephemeral PostgreSQL cluster for hermetic RLS tests (no Docker required).

PostgreSQL refuses to run as root, so when the test process is root the server
binaries are run as the ``postgres`` OS user; pytest still connects over TCP with
trust auth. On a non-root CI runner everything runs as the current user.
"""

from __future__ import annotations

import os
import pwd
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

_PG_VERSIONS = ("16", "17", "15", "14")
_REQUIRED = ("initdb", "pg_ctl", "postgres", "psql")


def _bin(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    for version in _PG_VERSIONS:
        candidate = Path(f"/usr/lib/postgresql/{version}/bin/{name}")
        if candidate.exists():
            return str(candidate)
    return None


def binaries_available() -> bool:
    return all(_bin(name) for name in _REQUIRED)


def _free_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port: int = sock.getsockname()[1]
    sock.close()
    return port


def _postgres_user() -> pwd.struct_passwd | None:
    if os.geteuid() != 0:
        return None
    try:
        return pwd.getpwnam("postgres")
    except KeyError:
        return None


class EphemeralPostgres:
    """A throwaway PostgreSQL cluster living in a temp directory."""

    def __init__(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="xsom-pg-"))
        self.datadir = self.tmp / "data"
        self.sockdir = self.tmp / "sock"
        self.logfile = self.tmp / "postgres.log"
        self.host = "127.0.0.1"
        self.port = _free_port()
        self._pw = _postgres_user()

    # -- process helpers --------------------------------------------------
    def _run(self, cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
        env = {
            "HOME": str(self.tmp),
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "LANG": "C",
            "LC_ALL": "C",
            "PGUSER": "postgres",
        }
        kwargs: dict[str, object] = {
            "capture_output": True,
            "text": True,
            "cwd": str(self.tmp),
            "env": env,
        }
        if self._pw is not None:
            kwargs["user"] = self._pw.pw_uid
            kwargs["group"] = self._pw.pw_gid
        result = subprocess.run(cmd, **kwargs)  # type: ignore[call-overload]
        if check and result.returncode != 0:
            raise RuntimeError(f"command failed: {cmd[0]}\n{result.stdout}\n{result.stderr}")
        return result

    def _prepare_perms(self) -> None:
        self.sockdir.mkdir(parents=True, exist_ok=True)
        if self._pw is not None:
            os.chown(self.tmp, self._pw.pw_uid, self._pw.pw_gid)
            os.chown(self.sockdir, self._pw.pw_uid, self._pw.pw_gid)

    # -- lifecycle --------------------------------------------------------
    def start(self) -> None:
        self._prepare_perms()
        self._run(
            [
                str(_bin("initdb")),
                "-D",
                str(self.datadir),
                "-U",
                "postgres",
                "-A",
                "trust",
                "-E",
                "UTF8",
                "--locale=C",
                "--no-sync",
            ]
        )
        options = (
            f"-p {self.port} -k {self.sockdir} -c listen_addresses=127.0.0.1 "
            "-c fsync=off -c synchronous_commit=off -c full_page_writes=off"
        )
        self._run(
            [
                str(_bin("pg_ctl")),
                "-D",
                str(self.datadir),
                "-l",
                str(self.logfile),
                "-o",
                options,
                "-w",
                "-t",
                "30",
                "start",
            ]
        )

    def stop(self) -> None:
        try:
            self._run(
                [str(_bin("pg_ctl")), "-D", str(self.datadir), "-m", "immediate", "-w", "stop"],
                check=False,
            )
        finally:
            shutil.rmtree(self.tmp, ignore_errors=True)

    # -- access -----------------------------------------------------------
    def url_for(self, dbname: str) -> str:
        return f"postgresql://postgres@{self.host}:{self.port}/{dbname}"

    def base_url(self) -> str:
        return self.url_for("postgres")

    def psql_apply(self, url: str, sql_file: Path) -> None:
        self._run([str(_bin("psql")), url, "-v", "ON_ERROR_STOP=1", "-q", "-f", str(sql_file)])
