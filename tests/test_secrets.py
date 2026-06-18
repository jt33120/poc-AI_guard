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
