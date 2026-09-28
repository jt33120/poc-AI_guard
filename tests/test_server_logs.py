"""Ce que Railway lit dans nos journaux dit la vérité sur leur gravité.

Relevé en production : chaque démarrage d'uvicorn (« Started server process »)
apparaissait comme une erreur, parce qu'uvicorn écrit du texte brut sur stderr, et
un client qui raccroche en cours d'envoi remontait comme une trace d'exception et
un 500. Les vraies erreurs se perdaient dans ce bruit.
"""

from __future__ import annotations

import io
import json
import logging

from fastapi.testclient import TestClient
from starlette.requests import ClientDisconnect

from api.main import create_app
from core.config import Settings
from core.logging import JsonFormatter, configure_logging


def test_uvicorn_records_are_json_with_their_real_level() -> None:
    server = logging.getLogger("uvicorn.error")
    server.addHandler(logging.StreamHandler())  # what uvicorn installs by default
    configure_logging("INFO")
    assert server.handlers == []
    assert server.propagate

    stream = io.StringIO()
    capture = logging.StreamHandler(stream)
    capture.setFormatter(JsonFormatter())
    logging.getLogger().addHandler(capture)
    try:
        server.info("Started server process [%d]", 2)
    finally:
        logging.getLogger().removeHandler(capture)
    record = json.loads(stream.getvalue())
    assert record["level"] == "INFO"
    assert record["logger"] == "uvicorn.error"


def test_a_caller_that_hangs_up_is_not_a_server_error(dev_settings: Settings) -> None:
    app = create_app(dev_settings)

    def _hang_up() -> None:
        raise ClientDisconnect

    app.add_api_route("/_probe/hang-up", _hang_up)
    response = TestClient(app, raise_server_exceptions=False).get("/_probe/hang-up")
    assert response.status_code == 499
    assert response.content == b""
