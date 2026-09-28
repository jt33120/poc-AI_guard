"""Le pool réutilise les connexions sans rien laisser passer d'une requête à l'autre.

**Pourquoi un pool.** Mesuré sur Railway : ouvrir une connexion TLS vers la base
coûte environ 1,5 s. `/v1/ai-traces`, qui en ouvrait deux, répondait en 3 s et ses
appelants abandonnaient (HTTP 499).

**Ce qu'il ne doit jamais faire.** L'isolation des tenants passe par `set local role`
et des revendications posées pour une transaction. Une connexion prêtée à nouveau
doit repartir vierge, et le travail non validé doit disparaître comme il disparaissait
à la fermeture.
"""

from __future__ import annotations

from collections.abc import Iterator
from uuid import uuid4

import psycopg
import pytest

from core import db as core_db
from core.config import Settings
from tests.conftest import DBHandle


@pytest.fixture
def pooled(db: DBHandle) -> Iterator[DBHandle]:
    core_db.configure_pool(1)
    try:
        yield db
    finally:
        core_db.configure_pool(0)


def _session(url: str) -> tuple[int, str, str | None]:
    with core_db.connection(url) as conn:
        row = conn.execute(
            "select pg_backend_pid(), current_user, current_setting('request.jwt.claims', true)"
        ).fetchone()
        assert row is not None
        return row[0], row[1], row[2] or None


def test_production_reuses_connections_and_development_does_not() -> None:
    assert Settings(_env_file=None, env="prod").database_pool_max == 5
    assert Settings(_env_file=None, env="dev").database_pool_max == 0
    assert Settings(_env_file=None, env="prod", database_pool_size=0).database_pool_max == 0
    assert Settings(_env_file=None, env="dev", database_pool_size=3).database_pool_max == 3


def test_a_connection_is_reused(pooled: DBHandle) -> None:
    first, _, _ = _session(pooled.url)
    second, _, _ = _session(pooled.url)
    assert first == second


def test_without_a_pool_each_use_opens_its_own_connection(db: DBHandle) -> None:
    first, _, _ = _session(db.url)
    second, _, _ = _session(db.url)
    assert first != second


def test_a_tenant_scope_does_not_outlive_its_request(pooled: DBHandle) -> None:
    owner = _session(pooled.url)[1]
    with core_db.tenant_reader(pooled.url, user_id=str(uuid4()), tenant_id=str(uuid4())) as conn:
        row = conn.execute("select current_user").fetchone()
        assert row == ("authenticated",)
    pid, user, claims = _session(pooled.url)
    assert (user, claims) == (owner, None)
    assert pid == _session(pooled.url)[0]


def test_a_session_setting_left_behind_is_wiped(pooled: DBHandle) -> None:
    """Défense en profondeur : même un `set` sans `local` ne passe pas."""
    owner = _session(pooled.url)[1]
    with core_db.connection(pooled.url) as conn:
        conn.execute("set role authenticated")
        conn.execute("select set_config('request.jwt.claims', '{\"sub\":\"x\"}', false)")
        conn.commit()
    assert _session(pooled.url)[1:] == (owner, None)


def test_uncommitted_work_is_discarded(pooled: DBHandle) -> None:
    with core_db.connection(pooled.url) as conn:
        conn.execute("create table pool_probe (x int)")
        conn.commit()
        conn.execute("insert into pool_probe values (1)")
    with core_db.connection(pooled.url) as conn:
        assert conn.execute("select count(*) from pool_probe").fetchone() == (0,)


def test_a_failed_transaction_does_not_poison_the_next_request(pooled: DBHandle) -> None:
    with pytest.raises(psycopg.errors.DivisionByZero), core_db.connection(pooled.url) as conn:
        conn.execute("select 1/0")
    with core_db.connection(pooled.url) as conn:
        assert conn.execute("select 1").fetchone() == (1,)


def test_a_dead_connection_is_replaced(pooled: DBHandle) -> None:
    pid = _session(pooled.url)[0]
    pooled.conn.execute("select pg_terminate_backend(%s)", (pid,))
    pooled.conn.commit()
    replacement, _, _ = _session(pooled.url)
    assert replacement != pid
