"""Self-serve signup: provisions tenant + admin + app_metadata; fail-closed."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient

from api.main import create_app
from core import signup
from core.config import Settings
from tests.conftest import DBHandle


class FakeAuthAdmin:
    """Stands in for Supabase Auth Admin; inserts into auth.users to honour the FK."""

    def __init__(self, db_url: str) -> None:
        self._db_url = db_url
        self.metadata: dict[str, dict[str, Any]] = {}
        self.created: list[str] = []
        self.deleted: list[str] = []
        self._emails: set[str] = set()

    def create_user(self, email: str, password: str) -> str:
        if email in self._emails:
            raise signup.AccountExists(email)
        uid = str(uuid4())
        with psycopg.connect(self._db_url) as c:
            c.execute("insert into auth.users (id, email) values (%s, %s)", (uid, email))
            c.commit()
        self._emails.add(email)
        self.created.append(uid)
        return uid

    def set_app_metadata(self, user_id: str, metadata: dict[str, Any]) -> None:
        self.metadata[user_id] = metadata

    def delete_user(self, user_id: str) -> None:
        self.deleted.append(user_id)
        with psycopg.connect(self._db_url) as c:
            c.execute("delete from auth.users where id = %s", (user_id,))
            c.commit()


def _app(db_url: str, admin: object | None) -> TestClient:
    app = create_app(Settings(_env_file=None, env="dev", database_url=db_url))
    app.state.auth_admin = admin
    return TestClient(app)


def test_signup_provisions_tenant_admin_and_metadata(db: DBHandle) -> None:
    fake = FakeAuthAdmin(db.url)
    client = _app(db.url, fake)
    resp = client.post(
        "/v1/signup", json={"org": "Acme Inc", "email": "Owner@Acme.com", "password": "s3cretpw!"}
    )
    assert resp.status_code == 201
    tenant_id = resp.json()["tenant_id"]

    with psycopg.connect(db.url) as c:
        assert c.execute("select name from tenants where id = %s", (tenant_id,)).fetchone()[0] == (
            "Acme Inc"
        )
        role = c.execute(
            "select role from memberships where tenant_id = %s", (tenant_id,)
        ).fetchone()
    assert role is not None and role[0] == "admin"
    # app_metadata (read by the API + RLS) was set, with the email normalised.
    uid = fake.created[0]
    assert fake.metadata[uid] == {"tenant_id": tenant_id, "role": "admin"}


def test_signup_duplicate_email_conflicts(db: DBHandle) -> None:
    client = _app(db.url, FakeAuthAdmin(db.url))
    body = {"org": "A", "email": "dup@x.com", "password": "password1"}
    assert client.post("/v1/signup", json=body).status_code == 201
    assert client.post("/v1/signup", json={**body, "org": "B"}).status_code == 409


def test_signup_disabled_when_not_configured(db: DBHandle) -> None:
    client = _app(db.url, None)
    resp = client.post("/v1/signup", json={"org": "A", "email": "a@b.com", "password": "password1"})
    assert resp.status_code == 503


def test_signup_validates_input(db: DBHandle) -> None:
    client = _app(db.url, FakeAuthAdmin(db.url))
    assert (
        client.post(
            "/v1/signup", json={"org": "A", "email": "a@b.com", "password": "short"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/v1/signup", json={"org": "A", "email": "not-an-email", "password": "password1"}
        ).status_code
        == 422
    )
