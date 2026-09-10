"""Structured JSON logging (CLAUDE.md §3).

Never log sensitive argument values, secrets, or PII — metadata only
(CLAUDE.md §4.10). That discipline is enforced at call sites; this module
only provides the JSON transport.

**La corrélation.** Un identifiant de requête circulait déjà jusqu'à l'audit,
mais aucun des points de journalisation ne le portait : on pouvait reconstituer
un appel d'outil en SQL, jamais depuis le flux de journaux. Le porter à la main
jusqu'à quarante sites d'appel aurait garanti qu'on l'oublie ; il voyage donc
dans un `ContextVar`, et un filtre l'injecte dans chaque enregistrement.
"""

from __future__ import annotations

import contextvars
import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

#: L'identifiant de la requête en cours, s'il y en a une.
#:
#: Un `ContextVar` et non une variable de module : `asyncio` fait tourner plusieurs
#: requêtes dans le même thread, et une globale les mélangerait. Le défaut est vide
#: plutôt que `None`, pour qu'un enregistrement hors requête reste bien formé.
id_requete: contextvars.ContextVar[str] = contextvars.ContextVar("id_requete", default="")


class _InjecteIdRequete(logging.Filter):
    """Pose `request_id` sur chaque enregistrement, depuis le contexte."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            courant = id_requete.get()
            if courant:
                record.request_id = courant
        return True


# Standard LogRecord attributes we must not duplicate into the JSON "extra" bag.
_RESERVED: frozenset[str] = frozenset(
    {
        "name",
        "msg",
        "args",
        "levelname",
        "levelno",
        "pathname",
        "filename",
        "module",
        "exc_info",
        "exc_text",
        "stack_info",
        "lineno",
        "funcName",
        "created",
        "msecs",
        "relativeCreated",
        "thread",
        "threadName",
        "processName",
        "process",
        "taskName",
    }
)


class JsonFormatter(logging.Formatter):
    """Render log records as single-line JSON."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        # Merge structured fields passed via logger.info(..., extra={...}).
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_logging(level: str = "INFO") -> None:
    """Install the JSON formatter on the root logger (idempotent).

    **Sur `stderr`, explicitement.** C'est déjà le défaut de `StreamHandler`,
    mais l'écrire est ce qui empêche une régression muette : la passerelle MCP
    porte le protocole sur **stdout**, et un handler qui y écrirait une ligne de
    journal casserait la session sans que rien ne dise pourquoi.
    """
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(_InjecteIdRequete())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())
