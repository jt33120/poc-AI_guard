"""Envelope encryption: round-trip, tamper/cross-tenant rejection, fail-closed."""

from __future__ import annotations

import base64
import os

import pytest

from core import secrets
from core.config import Settings
from core.secrets import LocalKeyProvider, SecretsError

KEK = base64.b64encode(os.urandom(32)).decode()


def _provider() -> LocalKeyProvider:
    return LocalKeyProvider(base64.b64decode(KEK))


def test_round_trip_recovers_the_secret() -> None:
    kp = _provider()
    blob = secrets.encrypt_secret(kp, "sk-super-secret", context="tenant-1")
    # The stored blob never contains the plaintext.
    assert "sk-super-secret" not in (blob.ciphertext + blob.wrapped_dek)
    assert secrets.decrypt_secret(kp, blob, context="tenant-1") == "sk-super-secret"


def test_tampered_ciphertext_is_rejected() -> None:
    kp = _provider()
    blob = secrets.encrypt_secret(kp, "value", context="t")
    raw = bytearray(base64.b64decode(blob.ciphertext))
    raw[0] ^= 0x01
    tampered = secrets.EncryptedBlob(
        blob.key_id, blob.wrapped_dek, blob.nonce, base64.b64encode(bytes(raw)).decode()
    )
    with pytest.raises(Exception):  # noqa: B017 - AESGCM raises InvalidTag
        secrets.decrypt_secret(kp, tampered, context="t")


def test_wrong_tenant_context_cannot_decrypt() -> None:
    kp = _provider()
    blob = secrets.encrypt_secret(kp, "value", context="tenant-A")
    with pytest.raises(Exception):  # noqa: B017 - AAD mismatch -> InvalidTag
        secrets.decrypt_secret(kp, blob, context="tenant-B")


def test_build_key_provider_local_in_dev() -> None:
    settings = Settings(
        _env_file=None, env="dev", secrets_kms_provider="local", secrets_local_kek=KEK
    )
    assert isinstance(secrets.build_key_provider(settings), LocalKeyProvider)


def test_local_provider_forbidden_in_prod() -> None:
    settings = Settings(
        _env_file=None, env="prod", secrets_kms_provider="local", secrets_local_kek=KEK
    )
    with pytest.raises(SecretsError):
        secrets.build_key_provider(settings)


def test_unconfigured_fails_closed() -> None:
    with pytest.raises(SecretsError):
        secrets.build_key_provider(Settings(_env_file=None, env="dev"))


def test_aws_requires_key_id() -> None:
    settings = Settings(_env_file=None, env="dev", secrets_kms_provider="aws")
    with pytest.raises(SecretsError):
        secrets.build_key_provider(settings)


# --- SecretStore (envelope vs Vault) -----------------------------------------


class _FakeResult:
    def __init__(self, row: object) -> None:
        self._row = row

    def fetchone(self) -> object:
        return self._row


class _FakeConn:
    """Minimal psycopg-like stub to exercise VaultSecretStore without Supabase."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.secret = "sk-vault-live"

    def execute(self, sql: str, params: object = ()) -> _FakeResult:
        self.calls.append(sql)
        if "create_secret" in sql:
            return _FakeResult(("11111111-1111-1111-1111-111111111111",))
        if "decrypted_secrets" in sql:
            return _FakeResult((self.secret,))
        return _FakeResult(None)

    def commit(self) -> None:
        pass


def test_envelope_store_round_trip() -> None:
    store = secrets.EnvelopeSecretStore(_provider())
    rec = store.put(None, tenant_id="t", plaintext="sk-x")  # type: ignore[arg-type]
    assert rec.backend == "envelope" and rec.ciphertext and "sk-x" not in rec.ciphertext
    assert store.get(None, tenant_id="t", record=rec) == "sk-x"  # type: ignore[arg-type]


def test_vault_store_round_trips_via_vault_sql() -> None:
    conn = _FakeConn()
    store = secrets.VaultSecretStore()
    rec = store.put(conn, tenant_id="t1", plaintext="sk-vault-live")  # type: ignore[arg-type]
    assert rec.backend == "vault" and rec.vault_secret_id
    assert any("vault.create_secret" in c for c in conn.calls)
    assert store.get(conn, tenant_id="t1", record=rec) == "sk-vault-live"  # type: ignore[arg-type]
    assert any("vault.decrypted_secrets" in c for c in conn.calls)


def test_build_secret_store_selects_backend() -> None:
    vault = Settings(_env_file=None, env="prod", secrets_kms_provider="vault")
    assert isinstance(secrets.build_secret_store(vault), secrets.VaultSecretStore)
    local = Settings(_env_file=None, env="dev", secrets_kms_provider="local", secrets_local_kek=KEK)
    assert isinstance(secrets.build_secret_store(local), secrets.EnvelopeSecretStore)
    with pytest.raises(SecretsError):
        secrets.build_secret_store(Settings(_env_file=None, env="dev"))
