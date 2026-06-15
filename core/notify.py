"""Approval notifications (SPEC §7). Email via SMTP/Gmail; Notion is out of scope.

Notifications are best-effort and must never carry secrets/PII — only the
redacted dry-run summary (CLAUDE.md §4.10). Callers treat failures as non-fatal:
a missed notification leaves the approval pending (safe), it never executes.
"""

from __future__ import annotations

import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from core.config import Settings


class Notifier(Protocol):
    def notify_approval(self, *, approval_id: str, summary: str, expires_at: str) -> None: ...


class NullNotifier:
    """No-op notifier (default when SMTP is not configured)."""

    def notify_approval(self, *, approval_id: str, summary: str, expires_at: str) -> None:
        return None


@dataclass
class SmtpNotifier:
    """Send approval requests by email (best-effort)."""

    host: str
    port: int
    sender: str
    recipient: str
    username: str | None = None
    password: str | None = None
    use_tls: bool = True

    def notify_approval(self, *, approval_id: str, summary: str, expires_at: str) -> None:
        message = EmailMessage()
        message["Subject"] = f"[xSOM AI Guard] Approval required: {approval_id}"
        message["From"] = self.sender
        message["To"] = self.recipient
        message.set_content(
            f"An agent action requires your approval.\n\n"
            f"Approval ID: {approval_id}\n"
            f"Effect (dry-run): {summary}\n"
            f"Expires at: {expires_at}\n"
        )
        with smtplib.SMTP(self.host, self.port, timeout=10) as smtp:
            if self.use_tls:
                smtp.starttls()
            if self.username and self.password:
                smtp.login(self.username, self.password)
            smtp.send_message(message)


def build_notifier(settings: Settings) -> Notifier:
    """SMTP notifier if fully configured, else a no-op notifier."""
    if settings.smtp_host and settings.smtp_from and settings.approval_notify_to:
        return SmtpNotifier(
            host=settings.smtp_host,
            port=settings.smtp_port,
            sender=settings.smtp_from,
            recipient=settings.approval_notify_to,
            username=settings.smtp_user,
            password=settings.smtp_password,
            use_tls=settings.smtp_use_tls,
        )
    return NullNotifier()
