"""Application settings, loaded and validated from the environment.

Single source of truth for configuration (CLAUDE.md §3). Values come from the
process environment or a local ``.env`` file (gitignored, CLAUDE.md §4.7).
Fields are added milestone by milestone; M0 only declares what M0 uses.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

Env = Literal["dev", "staging", "prod"]

#: Forme des revendications qu'un émetteur doit produire pour que ce déploiement
#: sache lire ses jetons (`FR-195`). Vocabulaire **fermé** : en nommer une inconnue
#: arrête le démarrage plutôt que de laisser croire qu'elle est supportée.
#:
#: - ``supabase_gotrue`` : le jeton porte ``app_metadata.tenant_id`` et
#:   ``app_metadata.role``, ce que lisent `api/security.py` et toute policy RLS.
#: - ``oidc_groups`` : émetteur OIDC du client (`FR-196`). Le rôle se déduit des
#:   groupes par ``ISSUER_GROUP_ROLES``, et le tenant vient de la revendication
#:   nommée par ``ISSUER_TENANT_CLAIM``.
IssuerClaims = Literal["supabase_gotrue", "oidc_groups"]

#: Où vit la clé privée qui signe les témoins de la chaîne d'audit (`FR-169`).
#:
#: Vocabulaire **fermé**, et **déclaratif** : aucune ligne de code ne peut constater
#: où un opérateur range un secret. C'est précisément ce que FR-169 demande — que le
#: système *déclare* la garde plutôt qu'il ne la suggère — et
#: `core/compliance.verification_independence` ne présente la vérification comme
#: indépendante que pour les deux valeurs qui mettent la clé hors de l'hôte de la base.
#:
#: - ``same_host`` : la graine est dans l'environnement du processus, sur la machine
#:   qui héberge aussi la base. Qui prend l'hôte prend les deux : le témoin protège
#:   de l'accident, de l'injection et de la restauration ratée, pas de l'administrateur.
#: - ``separate_host`` : la graine est injectée depuis une machine distincte.
#: - ``kms`` : la signature est déléguée à un service de gestion de clés.
#:
#: Non déclarée, la garde est **inconnue**, et l'inconnu se lit comme `same_host`
#: côté attestation : c'est la seule direction qui ne surpromet pas.
CheckpointCustody = Literal["same_host", "separate_host", "kms"]


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
    # ``NoDecode`` is load-bearing: without it pydantic-settings JSON-decodes
    # complex types straight out of the env/dotenv source, so the shipped
    # ``CORS_ALLOW_ORIGINS=http://localhost:3000`` blew up with a SettingsError
    # *before* the splitting validator below could ever run.
    cors_allow_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)

    # --- Supabase auth (JWT verification via JWKS) — M1 ------------------
    supabase_url: str | None = Field(default=None, max_length=300)
    # Explicit JWKS URL; if unset it is derived from supabase_url.
    supabase_jwks_url: str | None = Field(default=None, max_length=400)
    # Déclaration de l'opérateur qui apporte son propre émetteur (`FR-195`). Non
    # déclarée, la sonde de readiness refuse de dire `issuer: true` : voir
    # ``issuer_serves_our_claims``.
    issuer_claims: IssuerClaims | None = Field(default=None)
    # Fédération d'identité de la console (`FR-196`), lue seulement sous le profil
    # ``oidc_groups``. La correspondance est déclarative et son vocabulaire de rôles
    # est fermé : un rôle inconnu arrête le démarrage (`core/role_map.py`).
    issuer_groups_claim: str = Field(default="groups", max_length=120)
    issuer_group_roles: str | None = Field(default=None, max_length=2000)
    issuer_tenant_claim: str = Field(default="app_metadata.tenant_id", max_length=120)
    supabase_jwt_audience: str = Field(default="authenticated", max_length=80)
    supabase_jwt_issuer: str | None = Field(default=None, max_length=400)
    # Service-role key for admin operations (self-serve signup). Backend ONLY,
    # never the frontend (CLAUDE.md §4.6). Signup is disabled if unset.
    supabase_service_role_key: str | None = Field(default=None, max_length=600)
    signup_rate_limit: str = Field(default="10/hour", max_length=40)
    # Diagnostic public : ouvert et en écriture (il capture un lead), donc borné.
    triage_rate_limit: str = Field(default="20/hour", max_length=40)
    # Relevé public des menaces : ouvert, mais en **lecture seule** d'un artefact déjà
    # committé, sans base ni donnée personnelle. Il alimente un sélecteur de profils
    # sur une page publique, donc plusieurs appels par visite sont normaux — d'où une
    # borne bien plus large que le diagnostic, qui écrit.
    threats_rate_limit: str = Field(default="120/minute", max_length=40)

    # --- Database (backend connection) — M1 ------------------------------
    # psycopg DSN. The backend connects as the DSN's own role and relies on table
    # ownership; it does NOT bypass RLS (see `core/db.py`, corrected under `FR-195`).
    database_url: str | None = Field(default=None, max_length=500)

    # --- LLM judge (M6) — LiteLLM -> Mistral, optional -------------------
    mistral_api_key: str | None = Field(default=None, max_length=255)
    mistral_model: str = Field(default="mistral/mistral-small-latest", max_length=120)
    judge_max_calls: int = Field(default=200, ge=1, le=100_000)
    # La SEULE sortie réseau du dépôt qui n'était pas bornée, et elle est dans la
    # boucle de décision de `/v1/authorize` et de la passerelle. Toutes les autres
    # portent un délai (`core/notify.py` 10 s, `core/signup.py` 15 s,
    # `core/egress.py` 30/300 s, `api/llm_proxy.py` 120 s, `api/security.py` 5 s,
    # `api/health.py` 3 s). Un point de terminaison qui accepte la connexion sans
    # répondre gelait la décision pour toute la flotte du plan.
    #
    # Une expiration compte comme un échec de classification, donc `irreversible`
    # (`AD-34`) : mieux vaut une file d'approbation qui se remplit qu'une flotte
    # arrêtée ou, pire, une action risquée laissée passer faute de verdict.
    judge_timeout_seconds: float = Field(default=8.0, ge=0.5, le=120.0)

    # --- Garde-prompt tiers (`FR-193`) — LiteLLM -> Mistral, opt-in ------------
    #
    # Éteint par défaut, et l'asymétrie avec le juge est voulue : l'absence du juge
    # *durcit* la décision (`AD-34`), l'absence du garde-prompt ne change aucun
    # verdict — il n'est sur le chemin d'aucune décision. Ce qu'elle change, c'est ce
    # que l'Evidence Pack a le droit de dire.
    prompt_guard_enabled: bool = False
    prompt_guard_max_calls: int = Field(default=500, ge=1, le=100_000)
    # slowapi limit string for the costly export endpoint.
    export_rate_limit: str = Field(default="30/minute", max_length=40)
    # **Plafond d'INFRASTRUCTURE de `/v1/authorize`, pas la limite commerciale.**
    #
    # Ce que ce processus accepte d'un seul compartiment, quel que soit le palier. La
    # limite vendue vient de `plan_limits.authorize_rpm` (60 / 600 / 3000 selon le
    # palier) et se compose avec celle-ci — voir `api/ratelimit.py`.
    #
    # Le défaut est donc calé sur le plus haut palier publié, et pas plus bas : à
    # 120/minute il bridait à 120 un client `entreprise` qui a payé 3000, en silence,
    # puisqu'une limite qui s'applique ne casse rien. `xsom doctor` refuse une valeur
    # sous le plus haut palier.
    authorize_rate_limit: str = Field(default="3000/minute", max_length=40)

    # --- LLM provider proxy (zero-code monitoring) -----------------------
    # Upstream provider base; the agent points its OpenAI base_url at xSOM.
    openai_base_url: str = Field(default="https://api.openai.com", max_length=300)
    anthropic_base_url: str = Field(default="https://api.anthropic.com", max_length=300)
    mistral_base_url: str = Field(default="https://api.mistral.ai", max_length=300)
    openrouter_base_url: str = Field(default="https://openrouter.ai/api", max_length=300)
    # Même lecture que `authorize_rate_limit` : plafond d'infrastructure, calé sur le
    # plus haut `plan_limits.proxy_rpm` publié (6000/minute pour `entreprise`).
    llm_proxy_rate_limit: str = Field(default="6000/minute", max_length=40)
    # **L'ingestion OTLP a son propre réglage, et ce n'est pas du rangement.**
    # `POST /v1/ai-traces` partageait `llm_proxy_rate_limit`. Remonter ce dernier de
    # 240 à 6000 pour ne plus brider un palier `entreprise` aurait multiplié par 25 la
    # **seule** garde d'une route d'ingestion — qui n'est ni un appel de modèle, ni
    # plafonnée par `proxy_rpm`, ni servie par le même plan. Deux besoins, deux
    # réglages ; le défaut est celui qui s'appliquait jusqu'ici.
    ai_traces_rate_limit: str = Field(default="240/minute", max_length=40)
    # slowapi limit for the natural-language policy assistant (LLM-backed).
    policy_draft_rate_limit: str = Field(default="20/minute", max_length=40)

    # --- Egress data-loss guard (DLP) — block secrets / flag PII in prompts --
    # Scans the LLM proxy's outbound request body. OFF by default (backward
    # compatible; zero overhead when disabled). When on: fixed-form secrets are
    # blocked, structured PII is flagged (observe, don't break the agent), and
    # the high-entropy scan is opt-in. Never logs the value — kind + hash only.
    dlp_enabled: bool = False
    # Ceiling on an observation window (G-25). A window without a short deadline is
    # not an observation, it is a bypass -- so the ceiling is configuration, not a
    # per-request argument. Default: 24 h.
    monitor_max_hours: int = Field(default=24, ge=1, le=720)
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

    # --- Attestation de la chaîne d'audit (témoins signés, FR-169) --------
    # Graine Ed25519 en base64 (32 octets). Elle ne va JAMAIS en base : le schéma de
    # `audit_checkpoints` n'a aucune colonne où elle pourrait tomber, et seule la clé
    # publique dérivée est écrite. Absente ⇒ aucun témoin n'est posé, et l'Evidence
    # Pack continue de dire ce qu'il dit aujourd'hui.
    checkpoint_signing_key: str | None = Field(default=None, max_length=128)
    # Où cette graine est gardée. Voir `CheckpointCustody` : non déclarée, elle est
    # tenue pour partager l'hôte de la base.
    checkpoint_key_custody: CheckpointCustody | None = None

    # --- Point de scrutation opérationnel (/v1/ops/metrics) ---------------
    # Jeton porteur que le scrutateur présente. Absent ⇒ la route répond 404 : un
    # relevé de trafic derrière rien du tout dit à un anonyme quel déploiement vaut
    # la peine d'être attaqué, et §4.8 refuse déjà cette divulgation sur la sonde.
    ops_metrics_token: str | None = Field(default=None, max_length=200)

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

    @field_validator("issuer_claims", "checkpoint_key_custody", mode="before")
    @classmethod
    def _blank_is_undeclared(cls, value: object) -> object:
        """``ISSUER_CLAIMS=`` vide se lit « non déclaré », pas « valeur invalide ».

        Le fichier livré déclare chaque clé, vide par défaut, et un test du dépôt
        exige qu'il démarre un serveur (`test_shipped_env_example_boots_a_working_server`).
        Le vide reste **non déclaré** — donc toujours fail-closed côté sonde ; seule
        une valeur hors vocabulaire arrête le démarrage.
        """
        return None if value == "" else value

    @field_validator("cors_allow_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Accept a comma-separated string, or a JSON list, from the environment.

        Comma-separated is the documented form (``.env.example``). JSON is still
        honoured so deployments that already set ``["https://a"]`` keep working.
        """
        if not isinstance(value, str):
            return value
        raw = value.strip()
        if raw.startswith("["):
            try:
                return json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"CORS_ALLOW_ORIGINS is not valid JSON: {exc}") from None
        return [item.strip() for item in raw.split(",") if item.strip()]

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

    @property
    def issuer_serves_our_claims(self) -> bool:
        """L'émetteur configuré produit-il les revendications que le produit lit ?

        `FR-195`, et la réduction honnête du périmètre annoncé qu'il exige : xSOM
        fédère les émetteurs **présentant des revendications compatibles**, et non
        « n'importe quel fournisseur d'identité par configuration seule ».

        Servir un jeu de clés ne prouve rien : `api/security.py` lit
        ``app_metadata.tenant_id`` et ``app_metadata.role``, et toute policy RLS lit
        la même chose. Un émetteur qui ne les produit pas résout parfaitement et
        n'autorise jamais rien — ses jetons tombent en 403, ses requêtes rendent zéro
        ligne. Sans cette garde, la sonde annonçait `issuer: true` sur exactement
        cette configuration : un feu vert sur un déploiement qui ne peut pas
        fonctionner (`CLAUDE.md` §4.4, §9 — préférer le fail-closed).

        Deux chemins, et un seul demande une déclaration :

        - JWKS **dérivé** de ``supabase_url`` : c'est GoTrue par construction, donc
          la forme est connue sans que l'opérateur ait à l'affirmer.
        - JWKS **surchargé** par ``supabase_jwks_url`` : l'opérateur apporte son
          émetteur, et il déclare la forme de ses revendications. Non déclarée, elle
          est tenue pour incompatible.
        """
        if not self.jwks_url:
            return False
        if self.supabase_jwks_url:
            return self.issuer_claims is not None
        return True


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()
