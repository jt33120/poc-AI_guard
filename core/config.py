"""Application settings, loaded and validated from the environment.

Single source of truth for configuration (CLAUDE.md §3). Values come from the
process environment or a local ``.env`` file (gitignored, CLAUDE.md §4.7).
Fields are added milestone by milestone; M0 only declares what M0 uses.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Env = Literal["dev", "staging", "prod"]


class Settings(BaseSettings):
    """Validated runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Runtime ----------------------------------------------------------
    env: Env = "dev"
    app_name: str = Field(default="xSOM AI Guard", max_length=120)
    log_level: str = Field(default="INFO", max_length=10)

    # --- Control API hardening -------------------------------------------
    # Explicit allowlist only; "*" is rejected (CLAUDE.md §4.8).
    cors_allow_origins: list[str] = Field(default_factory=list)

    # --- Supabase auth (JWT verification via JWKS) — M1 ------------------
    supabase_url: str | None = Field(default=None, max_length=300)
    # Explicit JWKS URL; if unset it is derived from supabase_url.
    supabase_jwks_url: str | None = Field(default=None, max_length=400)
    supabase_jwt_audience: str = Field(default="authenticated", max_length=80)
    supabase_jwt_issuer: str | None = Field(default=None, max_length=400)
    # Service-role key for admin operations (self-serve signup). Backend ONLY,
    # never the frontend (CLAUDE.md §4.6). Signup is disabled if unset.
    supabase_service_role_key: str | None = Field(default=None, max_length=600)
    signup_rate_limit: str = Field(default="10/hour", max_length=40)

    # --- Database (backend / service_role connection) — M1 ---------------
    # psycopg DSN. Backend writes use a role that bypasses RLS (service_role).
    database_url: str | None = Field(default=None, max_length=500)

    # --- LLM judge (M6) — LiteLLM -> Mistral, optional -------------------
    mistral_api_key: str | None = Field(default=None, max_length=255)
    mistral_model: str = Field(default="mistral/mistral-small-latest", max_length=120)
    judge_max_calls: int = Field(default=200, ge=1, le=100_000)
    # slowapi limit string for the costly export endpoint.
    export_rate_limit: str = Field(default="30/minute", max_length=40)
    # slowapi limit string for the agent authorization endpoint (machine-to-machine).
    authorize_rate_limit: str = Field(default="120/minute", max_length=40)

    # --- LLM provider proxy (zero-code monitoring) -----------------------
    # Upstream provider base; the agent points its OpenAI base_url at xSOM.
    openai_base_url: str = Field(default="https://api.openai.com", max_length=300)
    anthropic_base_url: str = Field(default="https://api.anthropic.com", max_length=300)
    mistral_base_url: str = Field(default="https://api.mistral.ai", max_length=300)
    openrouter_base_url: str = Field(default="https://openrouter.ai/api", max_length=300)
    llm_proxy_rate_limit: str = Field(default="240/minute", max_length=40)
    # slowapi limit for the natural-language policy assistant (LLM-backed).
    policy_draft_rate_limit: str = Field(default="20/minute", max_length=40)

    # --- Egress data-loss guard (DLP) — block secrets / flag PII in prompts --
    # Scans the LLM proxy's outbound request body. OFF by default (backward
    # compatible; zero overhead when disabled). When on: fixed-form secrets are
    # blocked, structured PII is flagged (observe, don't break the agent), and
    # the high-entropy scan is opt-in. Never logs the value — kind + hash only.
    dlp_enabled: bool = False
    dlp_secret_action: Literal["block", "redact", "flag", "off"] = "block"  # noqa: S105
    dlp_pii_action: Literal["block", "redact", "flag", "off"] = "flag"
    dlp_entropy_action: Literal["flag", "off"] = "off"

    # --- Secrets (provider credentials) — envelope encryption -------------
    # KMS backend that wraps per-tenant data keys: "aws" (prod) or "local"
    # (dev/test only). Storing/decrypting a credential fails closed if this is
    # unset, or if "local" is used in prod (CLAUDE.md §4.4/§4.7).
    secrets_kms_provider: str | None = Field(default=None, max_length=20)
    aws_kms_key_id: str | None = Field(default=None, max_length=400)
    # Base64 32-byte key-encryption key for the local provider (NEVER in prod).
    secrets_local_kek: str | None = Field(default=None, max_length=128)

    # --- HITL approval notifications (M4, optional) ----------------------
    smtp_host: str | None = Field(default=None, max_length=255)
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_user: str | None = Field(default=None, max_length=255)
    smtp_password: str | None = Field(default=None, max_length=255)
    smtp_from: str | None = Field(default=None, max_length=255)
    smtp_use_tls: bool = True
    approval_notify_to: str | None = Field(default=None, max_length=255)

    # --- Compliance (EU AI Act, M9) --------------------------------------
    # Retention floor for operational data purges (days). EU AI Act art. 12
    # mandates >= 6 months (183 days) for high-risk logs; the compliance guard
    # refuses any purge below this, and readiness is not "ready" if it is lower.
    audit_retention_days: int = Field(default=183, ge=1)

    # --- Observability (optional) ----------------------------------------
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = Field(default=0.0, ge=0.0, le=1.0)

    @field_validator("cors_allow_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Accept a comma-separated string from the environment."""
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("cors_allow_origins")
    @classmethod
    def _reject_wildcard(cls, value: list[str]) -> list[str]:
        """Fail-closed: a wildcard CORS origin is never allowed (CLAUDE.md §4.8)."""
        if "*" in value:
            raise ValueError("CORS_ALLOW_ORIGINS must be explicit; wildcard '*' is forbidden")
        return value

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"

    @property
    def docs_enabled(self) -> bool:
        """Interactive API docs are disabled in production (CLAUDE.md §4.8)."""
        return self.env != "prod"

    @property
    def jwks_url(self) -> str | None:
        """Resolved JWKS endpoint (explicit override, else derived from URL)."""
        if self.supabase_jwks_url:
            return self.supabase_jwks_url
        if self.supabase_url:
            return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        return None


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()
