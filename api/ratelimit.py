"""Rate limiting for costly endpoints (slowapi) — CLAUDE.md §3/§4.9, M6."""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

from core.config import get_settings

limiter = Limiter(key_func=get_remote_address)


def export_rate_limit() -> str:
    """Dynamic limit string for the audit-export endpoint (from settings)."""
    return get_settings().export_rate_limit


def authorize_rate_limit() -> str:
    """Dynamic limit string for the agent authorization endpoint (from settings)."""
    return get_settings().authorize_rate_limit


def llm_proxy_rate_limit() -> str:
    """Dynamic limit string for the LLM monitoring proxy (from settings)."""
    return get_settings().llm_proxy_rate_limit


def policy_draft_rate_limit() -> str:
    """Dynamic limit string for the natural-language policy assistant."""
    return get_settings().policy_draft_rate_limit


def signup_rate_limit() -> str:
    """Dynamic limit string for the public self-serve signup endpoint."""
    return get_settings().signup_rate_limit


def triage_rate_limit() -> str:
    """Dynamic limit string for the public profile-diagnostic endpoint."""
    return get_settings().triage_rate_limit
