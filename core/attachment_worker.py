"""Offline binary extraction worker. Launched in a killable process, never a shell.

Only the text rendition leaves this process. Original pixels/PDF objects are not
considered sanitized, even when OCR finds no secret. No URLs or paths are opened.
"""

from __future__ import annotations

import io
import json
import math
import sys
import warnings
from contextlib import closing
from typing import Any

MAX_FILE_BYTES = 6 * 1024 * 1024
MAX_TEXT_BYTES = 256 * 1024
MAX_PIXELS = 12_000_000
MAX_PAGES = 12
MIN_CONFIDENCE = 0.80


def checked_text(text: str) -> str:
    if len(text.encode("utf-8")) > MAX_TEXT_BYTES:
        raise ValueError("attachment_text_too_large")
    if "\x00" in text:
        raise ValueError("attachment_invalid_text")
    return text


def _pixels(width: float, height: float) -> None:
    if not all(math.isfinite(n) and n > 0 for n in (width, height)):
        raise ValueError("attachment_dimensions_invalid")
    if math.ceil(width) * math.ceil(height) > MAX_PIXELS:
        raise ValueError("attachment_pixels_exceeded")


class Extractor:
    def __init__(self) -> None:
        self._engine: Any = None

    def ocr(self, image: Any) -> str:
        import onnxruntime
        from rapidocr_onnxruntime import RapidOCR

        if self._engine is None:
            onnxruntime.disable_telemetry_events()
            # v1.4.4 bundles the models in its wheel: no runtime download. Include
            # low-confidence detections, then refuse them rather than omit them.
            self._engine = RapidOCR(
                text_score=0.0,
                intra_op_num_threads=1,
                inter_op_num_threads=1,
            )
        result, _ = self._engine(image)
        if not result:
            return ""
        lines: list[str] = []
        for _, text, confidence in result:
            if not isinstance(text, str) or not math.isfinite(float(confidence)):
                raise ValueError("attachment_ocr_invalid")
            if float(confidence) < MIN_CONFIDENCE:
                raise ValueError("attachment_ocr_uncertain")
            lines.append(text)
        return checked_text("\n".join(lines))

    def png(self, data: bytes) -> str:
        from PIL import Image

        if not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("attachment_mime_mismatch")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format != "PNG" or getattr(image, "n_frames", 1) != 1:
                    raise ValueError("attachment_animation_unsupported")
                _pixels(*image.size)
                image.verify()
            with Image.open(io.BytesIO(data)) as image:
                # Flatten alpha explicitly on white, like a document page.
                rgba = image.convert("RGBA")
                with Image.new("RGB", image.size, "white") as canvas:
                    canvas.paste(rgba, mask=rgba.getchannel("A"))
                    return self.ocr(canvas)

    def pdf(self, data: bytes) -> str:
        import pypdfium2 as pdfium
        import pypdfium2.raw as pdfium_raw

        if not data.startswith(b"%PDF-"):
            raise ValueError("attachment_mime_mismatch")
        with pdfium.PdfDocument(data) as document:
            if pdfium_raw.FPDF_GetSecurityHandlerRevision(document) >= 0:
                raise ValueError("attachment_encrypted")
            if not 1 <= len(document) <= MAX_PAGES:
                raise ValueError("attachment_pages_exceeded")
            parts: list[str] = []
            for index in range(len(document)):
                with closing(document[index]) as page:
                    width, height = page.get_size()
                    scale = 2.0  # 144 dpi; reject oversized pages, never silently crop.
                    _pixels(width * scale, height * scale)
                    with closing(page.get_textpage()) as text_page:
                        text = text_page.get_text_range(errors="strict")
                    # OCR every page, including mixed text + screenshot PDFs.
                    with (
                        closing(page.render(scale=scale, draw_annots=True)) as bitmap,
                        bitmap.to_pil() as image,
                    ):
                        visual = self.ocr(image)
                    if not text.strip() and not visual.strip():
                        raise ValueError("attachment_no_readable_text")
                    parts.append(f"[Page {index + 1}]\n{text}\n{visual}")
                    checked_text("\n".join(parts))
            return "\n".join(parts)


def main() -> None:
    try:
        # Linux production has an OS memory/CPU ceiling as well as format limits.
        # On Windows the parent enforces time, byte, page and pixel bounds.
        if sys.platform == "linux":
            import resource

            resource.setrlimit(resource.RLIMIT_AS, (3 * 1024**3, 3 * 1024**3))
            resource.setrlimit(resource.RLIMIT_CPU, (40, 40))
        data = sys.stdin.buffer.read(MAX_FILE_BYTES + 1)
        if not data or len(data) > MAX_FILE_BYTES:
            raise ValueError("attachment_size_exceeded")
        extractor = Extractor()
        match sys.argv[1:]:
            case ["image/png"]:
                text = extractor.png(data)
            case ["application/pdf"]:
                text = extractor.pdf(data)
            case _:
                raise ValueError("attachment_type_unsupported")
        if not text.strip():
            raise ValueError("attachment_no_readable_text")
        payload = {"text": checked_text(text)}
    except Exception as exc:
        # Never serialize parser exceptions: they can contain document content.
        safe_errors = {
            "attachment_size_exceeded",
            "attachment_text_too_large",
            "attachment_invalid_text",
            "attachment_dimensions_invalid",
            "attachment_pixels_exceeded",
            "attachment_pages_exceeded",
            "attachment_ocr_invalid",
            "attachment_ocr_uncertain",
            "attachment_mime_mismatch",
            "attachment_animation_unsupported",
            "attachment_encrypted",
            "attachment_no_readable_text",
            "attachment_type_unsupported",
        }
        reason = str(exc) if isinstance(exc, ValueError) else ""
        payload = {"error": reason if reason in safe_errors else "attachment_extraction_failed"}
    sys.stdout.buffer.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    main()
