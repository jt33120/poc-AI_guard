"""Bounded attachment-to-text conversion for Secret Guard's controlled relay."""

from __future__ import annotations

import base64
import binascii
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from core.attachment_worker import MAX_FILE_BYTES, MAX_TEXT_BYTES, checked_text

MAX_REQUEST_BYTES = 16 * 1024 * 1024
MAX_TOTAL_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENTS = 4
TIMEOUT_SECONDS = 45.0
_WORKERS = threading.BoundedSemaphore(2)
_WORKER = Path(__file__).with_name("attachment_worker.py")


class AttachmentError(ValueError):
    """Content-free, machine-readable refusal reason."""


def _extract_binary(data: bytes, media_type: str, timeout: float) -> str:
    if timeout <= 0:
        raise AttachmentError("attachment_timeout")
    if not _WORKERS.acquire(blocking=False):
        raise AttachmentError("attachment_extractor_busy")
    try:
        # No inherited provider credentials, user config, PYTHONPATH or shell.
        env = {
            key: os.environ[key]
            for key in ("SystemRoot", "WINDIR", "TEMP", "TMP")
            if key in os.environ
        }
        env.update(OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1")
        result = subprocess.run(  # noqa: S603 -- fixed interpreter/script; MIME allowlisted below
            [sys.executable, "-I", str(_WORKER), media_type],
            input=data,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            check=False,
            env=env,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        if result.returncode != 0 or len(result.stdout) > MAX_TEXT_BYTES * 6 + 100:
            raise AttachmentError("attachment_extraction_failed")
        payload = json.loads(result.stdout)
        if not isinstance(payload, dict):
            raise AttachmentError("attachment_extraction_failed")
        if "error" in payload:
            # Worker owns these codes, not the submitted document.
            reason = payload["error"]
            if not isinstance(reason, str) or not reason.startswith("attachment_"):
                reason = "attachment_extraction_failed"
            raise AttachmentError(reason)
        text = payload.get("text")
        if not isinstance(text, str) or not text.strip():
            raise AttachmentError("attachment_no_readable_text")
        return checked_text(text)
    except subprocess.TimeoutExpired:
        # subprocess.run kills and reaps the worker, not just the awaiting thread.
        raise AttachmentError("attachment_timeout") from None
    except AttachmentError:
        raise
    except (OSError, ValueError):
        raise AttachmentError("attachment_extraction_failed") from None
    finally:
        _WORKERS.release()


class AttachmentReader:
    """Per-request budget, including history and attachments inside tool results."""

    def __init__(self) -> None:
        self.count = 0
        self.total_bytes = 0
        self.formats: set[str] = set()
        self.deadline = time.monotonic() + TIMEOUT_SECONDS

    def read(self, block: dict[str, object]) -> str:
        self.count += 1
        if self.count > MAX_ATTACHMENTS:
            raise AttachmentError("attachment_count_exceeded")
        source = block.get("source")
        if not isinstance(source, dict):
            raise AttachmentError("attachment_source_required")
        media_type = source.get("media_type")
        allowed = (
            {"image/png"}
            if block.get("type") == "image"
            else {
                "application/pdf",
                "text/markdown",
                "text/plain",
            }
        )
        if not isinstance(media_type, str) or media_type not in allowed:
            raise AttachmentError("attachment_type_unsupported")
        encoded = source.get("data")
        if not isinstance(encoded, str):
            raise AttachmentError("attachment_inline_data_required")
        if source.get("type") == "base64":
            if len(encoded) > 4 * ((MAX_FILE_BYTES + 2) // 3):
                raise AttachmentError("attachment_size_exceeded")
            try:
                data = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error):
                raise AttachmentError("attachment_invalid_base64") from None
        elif source.get("type") == "text" and media_type in {"text/plain", "text/markdown"}:
            try:
                data = encoded.encode("utf-8")
            except UnicodeError:
                raise AttachmentError("attachment_invalid_text") from None
        else:
            # Never fetch a URL, file ID, local path or Markdown link.
            raise AttachmentError("attachment_source_unsupported")
        self.total_bytes += len(data)
        if len(data) > MAX_FILE_BYTES or self.total_bytes > MAX_TOTAL_BYTES:
            raise AttachmentError("attachment_size_exceeded")
        if time.monotonic() >= self.deadline:
            raise AttachmentError("attachment_timeout")
        if media_type in {"text/plain", "text/markdown"}:
            try:
                text = data.decode("utf-8-sig")
            except UnicodeError:
                raise AttachmentError("attachment_invalid_text") from None
            try:
                checked_text(text)
            except ValueError as exc:
                raise AttachmentError(str(exc)) from None
        else:
            text = _extract_binary(data, str(media_type), self.deadline - time.monotonic())
        self.formats.add(str(media_type))
        return text
