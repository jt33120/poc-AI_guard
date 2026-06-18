"""Envelope encryption for customer provider credentials (CLAUDE.md §4.7).

We must hold third-party billing/admin keys to pull authoritative spend. They are
never stored in the clear: a fresh per-secret **data key** (DEK) encrypts the
secret with AES-256-GCM, and the DEK itself is **wrapped by a KMS key** whose
root never touches our database. The tenant id is bound as additional
authenticated data (AAD) so a ciphertext cannot be replayed across tenants.

Backends are pluggable:
  * ``aws``   — AWS KMS wraps/unwraps the DEK (production).
  * ``local`` — a local KEK from the environment (dev/test only; refused in prod).

Everything is fail-closed: with no backend configured — or ``local`` in prod —
storing or decrypting a credential raises rather than degrading (CLAUDE.md §4.4).
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import uuid4

import psycopg
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from core.config import Settings

_NONCE_BYTES = 12
_DEK_BITS = 256


class SecretsError(Exception):
    """Raised when secrets cannot be configured, encrypted, or decrypted."""


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


@dataclass(frozen=True)
class EncryptedBlob:
    """An envelope-encrypted secret: nothing here reveals the plaintext."""

    key_id: str
    wrapped_dek: str  # base64
    nonce: str  # base64
    ciphertext: str  # base64


class KeyProvider(Protocol):
    """Wraps/unwraps data keys via a KMS whose root key stays out of the DB."""

    @property
    def key_id(self) -> str: ...

    def generate_data_key(self, context: bytes) -> tuple[bytes, bytes]:
        """Return (plaintext_dek, wrapped_dek)."""
        ...

    def unwrap(self, wrapped_dek: bytes, context: bytes) -> bytes:
        """Return the plaintext DEK for a previously wrapped key."""
        ...


class LocalKeyProvider:
    """Dev/test backend: wraps the DEK with a local KEK (AES-GCM). Never in prod."""

    key_id = "local"

    def __init__(self, kek: bytes) -> None:
        if len(kek) != 32:
            raise SecretsError("local KEK must be 32 bytes")
        self._kek = kek

    def generate_data_key(self, context: bytes) -> tuple[bytes, bytes]:
        dek = AESGCM.generate_key(bit_length=_DEK_BITS)
        nonce = os.urandom(_NONCE_BYTES)
        wrapped = nonce + AESGCM(self._kek).encrypt(nonce, dek, context)
        return dek, wrapped

    def unwrap(self, wrapped_dek: bytes, context: bytes) -> bytes:
        nonce, blob = wrapped_dek[:_NONCE_BYTES], wrapped_dek[_NONCE_BYTES:]
        return AESGCM(self._kek).decrypt(nonce, blob, context)


class AwsKmsKeyProvider:
    """Production backend: AWS KMS generates/decrypts the DEK (boto3, lazy)."""

    def __init__(self, key_id: str) -> None:
        self._key_id = key_id
        self._client = None

    @property
    def key_id(self) -> str:
        return self._key_id

    def _kms(self) -> Any:
        if self._client is None:
            try:
                import boto3
            except ImportError as exc:  # pragma: no cover - prod-only dependency
                raise SecretsError("boto3 is required for the AWS KMS provider") from exc
            self._client = boto3.client("kms")
        return self._client

    def generate_data_key(self, context: bytes) -> tuple[bytes, bytes]:
        resp = self._kms().generate_data_key(
            KeyId=self._key_id,
            KeySpec="AES_256",
            EncryptionContext={"tenant": context.decode()},
        )
        return bytes(resp["Plaintext"]), bytes(resp["CiphertextBlob"])

    def unwrap(self, wrapped_dek: bytes, context: bytes) -> bytes:
        resp = self._kms().decrypt(
            CiphertextBlob=wrapped_dek,
            EncryptionContext={"tenant": context.decode()},
            KeyId=self._key_id,
        )
        return bytes(resp["Plaintext"])


def build_key_provider(settings: Settings) -> KeyProvider:
    """Construct the configured key provider, fail-closed (CLAUDE.md §4.4)."""
    provider = (settings.secrets_kms_provider or "").lower()
    if provider == "aws":
        if not settings.aws_kms_key_id:
            raise SecretsError("AWS_KMS_KEY_ID is required for the aws provider")
        return AwsKmsKeyProvider(settings.aws_kms_key_id)
    if provider == "local":
        if settings.is_prod:
            raise SecretsError("the local secrets provider is forbidden in production")
        if not settings.secrets_local_kek:
            raise SecretsError("SECRETS_LOCAL_KEK is required for the local provider")
        try:
            kek = base64.b64decode(settings.secrets_local_kek)
        except (ValueError, TypeError) as exc:
            raise SecretsError("SECRETS_LOCAL_KEK must be valid base64") from exc
        return LocalKeyProvider(kek)
    raise SecretsError("no secrets KMS provider configured")


def encrypt_secret(provider: KeyProvider, plaintext: str, *, context: str) -> EncryptedBlob:
    """Envelope-encrypt ``plaintext``, binding it to ``context`` (the tenant id)."""
    aad = context.encode()
    dek, wrapped = provider.generate_data_key(aad)
    nonce = os.urandom(_NONCE_BYTES)
    ciphertext = AESGCM(dek).encrypt(nonce, plaintext.encode(), aad)
    return EncryptedBlob(provider.key_id, _b64(wrapped), _b64(nonce), _b64(ciphertext))


def decrypt_secret(provider: KeyProvider, blob: EncryptedBlob, *, context: str) -> str:
    """Recover the plaintext for an :class:`EncryptedBlob` (same tenant context)."""
    aad = context.encode()
    dek = provider.unwrap(base64.b64decode(blob.wrapped_dek), aad)
    plaintext = AESGCM(dek).decrypt(
        base64.b64decode(blob.nonce), base64.b64decode(blob.ciphertext), aad
    )
    return plaintext.decode()


# ---------------------------------------------------------------------------
# Secret store: how a credential is persisted/recovered (envelope vs Vault).
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class SecretRecord:
    """The columns to persist for a stored secret (no plaintext)."""

    backend: str
    key_id: str | None = None
    wrapped_dek: str | None = None
    nonce: str | None = None
    ciphertext: str | None = None
    vault_secret_id: str | None = None


class SecretStore(Protocol):
    """Stores/recovers a tenant secret. ``conn`` lets DB-backed stores (Vault) work."""

    def put(self, conn: psycopg.Connection, *, tenant_id: str, plaintext: str) -> SecretRecord: ...

    def get(self, conn: psycopg.Connection, *, tenant_id: str, record: SecretRecord) -> str: ...


class EnvelopeSecretStore:
    """Stores the ciphertext in our own table, wrapping the DEK via a KMS KeyProvider."""

    def __init__(self, provider: KeyProvider) -> None:
        self._provider = provider

    def put(self, conn: psycopg.Connection, *, tenant_id: str, plaintext: str) -> SecretRecord:
        blob = encrypt_secret(self._provider, plaintext, context=tenant_id)
        return SecretRecord(
            backend="envelope",
            key_id=blob.key_id,
            wrapped_dek=blob.wrapped_dek,
            nonce=blob.nonce,
            ciphertext=blob.ciphertext,
        )

    def get(self, conn: psycopg.Connection, *, tenant_id: str, record: SecretRecord) -> str:
        if not (record.key_id and record.wrapped_dek and record.nonce and record.ciphertext):
            raise SecretsError("incomplete envelope secret record")
        blob = EncryptedBlob(record.key_id, record.wrapped_dek, record.nonce, record.ciphertext)
        return decrypt_secret(self._provider, blob, context=tenant_id)


class VaultSecretStore:
    """Delegates storage to Supabase Vault: the root key stays outside the DB."""

    def put(self, conn: psycopg.Connection, *, tenant_id: str, plaintext: str) -> SecretRecord:
        name = f"xsom:{tenant_id}:{uuid4().hex}"
        row = conn.execute(
            "select vault.create_secret(%s, %s, %s)",
            (plaintext, name, f"xSOM provider credential (tenant {tenant_id})"),
        ).fetchone()
        conn.commit()
        if row is None:  # pragma: no cover - create_secret always returns the id
            raise SecretsError("vault.create_secret returned no id")
        return SecretRecord(backend="vault", vault_secret_id=str(row[0]))

    def get(self, conn: psycopg.Connection, *, tenant_id: str, record: SecretRecord) -> str:
        if not record.vault_secret_id:
            raise SecretsError("missing vault_secret_id")
        row = conn.execute(
            "select decrypted_secret from vault.decrypted_secrets where id = %s",
            (record.vault_secret_id,),
        ).fetchone()
        if row is None:
            raise SecretsError("vault secret not found")
        return str(row[0])


def build_secret_store(settings: Settings) -> SecretStore:
    """Construct the configured secret store, fail-closed (CLAUDE.md §4.4).

    ``vault`` (Supabase Vault) is the production default; ``aws``/``local`` use
    in-app envelope encryption with the matching KMS key provider.
    """
    provider = (settings.secrets_kms_provider or "").lower()
    if provider == "vault":
        return VaultSecretStore()
    if provider in ("aws", "local"):
        return EnvelopeSecretStore(build_key_provider(settings))
    raise SecretsError("no secrets backend configured")
