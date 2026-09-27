"""Error handling that never leaks internals to the client (CLAUDE.md §4.8).

Unhandled exceptions are logged server-side (with a correlation id) and the
client receives a generic 500 — no stack trace, no exception message.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
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


#: Routes dont le corps porte des valeurs confidentielles en clair (termes d'un réglage
#: sur mesure, texte d'essai). Un refus de validation n'y renvoie jamais la valeur reçue.
_CONFIDENTIAL_BODIES = ("/v1/xsom/",)


async def _validation_handler(request: Request, exc: Exception) -> JSONResponse:
    """422 sans écho : sur les routes confidentielles, ni ``input`` ni ``ctx``.

    Le gestionnaire par défaut de FastAPI renvoie la valeur refusée. Un terme trop long
    ou un texte d'essai hors borne repartirait donc tel quel vers le client, et vers tout
    proxy ou outil qui enregistre les corps d'erreur (`CLAUDE.md` §4.10).
    """
    if not isinstance(exc, RequestValidationError):  # pragma: no cover - enregistré pour ce type
        return await _unhandled_exception_handler(request, exc)
    if not request.url.path.startswith(_CONFIDENTIAL_BODIES):
        return await request_validation_exception_handler(request, exc)
    errors = [
        {"type": error.get("type"), "loc": list(error.get("loc", ())), "msg": error.get("msg")}
        for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": errors})


def register_exception_handlers(app: FastAPI) -> None:
    """Attach the generic exception handler to the app."""
    app.add_exception_handler(Exception, _unhandled_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_handler)
