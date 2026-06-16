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
