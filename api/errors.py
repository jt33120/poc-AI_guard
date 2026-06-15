"""Error handling that never leaks internals to the client (CLAUDE.md §4.8).

Unhandled exceptions are logged server-side (with a correlation id) and the
client receives a generic 500 — no stack trace, no exception message.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("xsom.api")


async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    error_id = uuid.uuid4().hex
    logger.error(
        "unhandled_exception",
        exc_info=exc,
        extra={"error_id": error_id, "path": request.url.path, "method": request.method},
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error_id": error_id},
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Attach the generic exception handler to the app."""
    app.add_exception_handler(Exception, _unhandled_exception_handler)
