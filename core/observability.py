"""Optional Sentry initialization (CLAUDE.md §3).

Observability must never be required to boot: with no DSN configured this is a
no-op. ``send_default_pii`` is forced off so we never ship PII to Sentry
(CLAUDE.md §4.10).
"""

from __future__ import annotations

from core.config import Settings


def init_observability(settings: Settings) -> bool:
    """Initialize Sentry when a DSN is configured. Returns True if enabled."""
    if not settings.sentry_dsn:
        return False

    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.env,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
    )
    return True
