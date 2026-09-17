"""Synthetic, real PNG/PDF extraction plus fail-closed envelope/worker contracts."""

import base64
import io
import json
import subprocess
import time

import pytest
from fpdf import FPDF
from PIL import Image, ImageDraw, ImageFont

from core import attachments
from core.attachment_worker import MAX_PAGES, MAX_PIXELS, Extractor
from core.extension_redaction import clean

SYNTHETIC = "PASSWORD=synthetic-only"


def png(text: str = SYNTHETIC) -> bytes:
    with Image.new("RGB", (1000, 160), "white") as image:
        ImageDraw.Draw(image).text(
            (30, 50), text, fill="black", font=ImageFont.load_default(size=36)
        )
        output = io.BytesIO()
        image.save(output, format="PNG")
        return output.getvalue()


def pdf(*, raster: bool = False, mixed: bool = False) -> bytes:
    document = FPDF()
    document.add_page()
    if not raster or mixed:
        document.set_font("Courier", size=18)
        document.cell(text="Ordinary document" if mixed else SYNTHETIC)
    if raster:
        document.image(io.BytesIO(png()), x=10, y=35, w=180)
    return bytes(document.output())


def block(data: bytes, media_type: str) -> dict:
    return {
        "type": "image" if media_type.startswith("image/") else "document",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": base64.b64encode(data).decode("ascii"),
        },
    }


def request(content: object) -> bytes:
    return json.dumps(
        {
            "model": "claude-test",
            "messages": [
                {"role": "user", "content": content},
            ],
        }
    ).encode()


@pytest.mark.parametrize("kind", ["markdown", "png", "pdf_text", "pdf_scan", "pdf_mixed"])
def test_real_attachment_is_read_cleaned_and_original_never_forwarded(kind: str) -> None:
    if kind == "markdown":
        data, mime = f"# Example\n{SYNTHETIC}".encode(), "text/markdown"
    elif kind == "png":
        data, mime = png(), "image/png"
    else:
        data, mime = pdf(raster=kind != "pdf_text", mixed=kind == "pdf_mixed"), "application/pdf"
    item = block(data, mime)
    result = clean(request([{"type": "text", "text": "Read this attachment"}, item]))
    content = json.loads(result.body)["messages"][0]["content"]
    assert content[0]["text"] == "Read this attachment"
    assert content[1]["type"] == "text"
    assert "XXX" in content[1]["text"]
    assert "synthetic-only" not in content[1]["text"]
    assert item["source"]["data"].encode() not in result.body
    assert "source" not in content[1]
    assert result.count >= 1
    assert result.attachments == 1
    assert result.attachment_formats == (mime,)
    assert clean(result.body).count == 0


def test_markdown_inline_metadata_history_and_tool_results() -> None:
    item = {
        "type": "document",
        "title": "pwd=title-only",
        "context": "safe context",
        "source": {
            "type": "text",
            "media_type": "text/plain",
            "data": "# Notes\nPASSWORD=synthetic-only\nUseful text",
        },
    }
    result = clean(request([{"type": "tool_result", "tool_use_id": "tool_1", "content": [item]}]))
    assert result.count == 2
    assert b"Useful text" in result.body and b"safe context" in result.body
    assert b"title-only" not in result.body and b"synthetic-only" not in result.body
    assert b"tool_1" in result.body


@pytest.mark.parametrize(
    "source",
    [
        None,
        {},
        {"type": "url", "url": "https://example.invalid/private.pdf"},
        {"type": "file", "file_id": "uninspectable"},
        {"type": "base64", "media_type": "application/pdf", "data": "not base64!"},
        {"type": "base64", "media_type": ["application/pdf"], "data": ""},
        {"type": "base64", "media_type": "image/jpeg", "data": ""},
        {"type": "text", "media_type": "text/plain", "data": "nul\u0000byte"},
    ],
)
def test_invalid_or_external_sources_refused_without_running_worker(source, monkeypatch) -> None:
    def unexpected(*args):
        pytest.fail("Invalid/external sources must not invoke an extractor")

    monkeypatch.setattr(attachments, "_extract_binary", unexpected)
    with pytest.raises(attachments.AttachmentError):
        clean(request([{"type": "document", "source": source}]))


@pytest.mark.parametrize(
    "data,mime",
    [
        (b"not a png", "image/png"),
        (b"not a pdf", "application/pdf"),
        (b"%PDF-corrupt", "application/pdf"),
        (b"\xff\xfe", "text/markdown"),
    ],
)
def test_corrupt_and_mislabeled_files_are_refused(data, mime) -> None:
    with pytest.raises(attachments.AttachmentError):
        clean(request([block(data, mime)]))


def test_empty_screenshot_is_not_claimed_readable() -> None:
    with pytest.raises(attachments.AttachmentError, match="no_readable_text"):
        clean(request([block(png(""), "image/png")]))


def test_low_confidence_ocr_is_not_silently_dropped() -> None:
    reader = Extractor()
    reader._engine = lambda image: ([[[], "uncertain", 0.3]], None)
    with pytest.raises(ValueError, match="ocr_uncertain"):
        reader.ocr(None)


def test_attachment_count_and_decoded_budgets(monkeypatch) -> None:
    item = block(b"hello", "text/markdown")
    with pytest.raises(attachments.AttachmentError, match="count_exceeded"):
        clean(request([item] * (attachments.MAX_ATTACHMENTS + 1)))
    monkeypatch.setattr(attachments, "MAX_TOTAL_BYTES", 9)
    with pytest.raises(attachments.AttachmentError, match="size_exceeded"):
        clean(request([item, item]))
    monkeypatch.setattr(attachments, "MAX_FILE_BYTES", 3)
    with pytest.raises(attachments.AttachmentError, match="size_exceeded"):
        clean(request([item]))


def test_pdf_page_budget() -> None:
    document = FPDF()
    for _ in range(MAX_PAGES + 1):
        document.add_page()
    with pytest.raises(attachments.AttachmentError, match="pages_exceeded"):
        clean(request([block(bytes(document.output()), "application/pdf")]))


def test_encrypted_pdf_is_refused_even_with_empty_user_password() -> None:
    document = FPDF()
    document.add_page()
    document.set_encryption(owner_password="synthetic-owner", user_password="")
    with pytest.raises(attachments.AttachmentError, match="encrypted"):
        clean(request([block(bytes(document.output()), "application/pdf")]))


def test_animated_png_is_refused() -> None:
    with Image.new("RGB", (20, 20), "white") as first, Image.new("RGB", (20, 20), "black") as last:
        output = io.BytesIO()
        first.save(output, format="PNG", save_all=True, append_images=[last])
    with pytest.raises(attachments.AttachmentError, match="animation_unsupported"):
        clean(request([block(output.getvalue(), "image/png")]))


def test_extracted_text_budget_never_truncates() -> None:
    item = block(b"a" * (attachments.MAX_TEXT_BYTES + 1), "text/markdown")
    with pytest.raises(attachments.AttachmentError, match="text_too_large"):
        clean(request([item]))


def test_pixel_budget_before_ocr(monkeypatch) -> None:
    from core.attachment_worker import _pixels

    with pytest.raises(ValueError, match="pixels_exceeded"):
        _pixels(MAX_PIXELS + 1, 1)


def test_request_timeout_and_no_concurrent_overload(monkeypatch) -> None:
    reader = attachments.AttachmentReader()
    reader.deadline = time.monotonic() - 1
    with pytest.raises(attachments.AttachmentError, match="timeout"):
        reader.read(block(b"hello", "text/plain"))
    assert attachments._WORKERS.acquire(blocking=False)
    assert attachments._WORKERS.acquire(blocking=False)
    try:
        with pytest.raises(attachments.AttachmentError, match="busy"):
            attachments._extract_binary(b"x", "image/png", 1)
    finally:
        attachments._WORKERS.release()
        attachments._WORKERS.release()


@pytest.mark.parametrize("failure", ["timeout", "crash", "malformed", "oserror"])
def test_worker_failures_are_safe_and_release_slot(failure, monkeypatch) -> None:
    def run(*args, **kwargs):
        assert kwargs["stderr"] == subprocess.DEVNULL
        assert "SECRET_TEST_CREDENTIAL" not in kwargs["env"]
        if failure == "timeout":
            raise subprocess.TimeoutExpired("fixed-worker", 1)
        if failure == "oserror":
            raise OSError("content must not escape")
        return subprocess.CompletedProcess([], 1 if failure == "crash" else 0, b"malformed")

    monkeypatch.setenv("SECRET_TEST_CREDENTIAL", "synthetic-not-real")
    monkeypatch.setattr(attachments.subprocess, "run", run)
    with pytest.raises(attachments.AttachmentError) as error:
        attachments._extract_binary(b"input", "image/png", 1)
    assert str(error.value).startswith("attachment_")
    assert "content" not in str(error.value)
    assert attachments._WORKERS.acquire(blocking=False)
    attachments._WORKERS.release()
