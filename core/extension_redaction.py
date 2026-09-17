"""Bounded JSON-aware prompt cleaning for registered extension traffic."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from core import attachments, dlp

MAX_BYTES = 1_048_576
_KEY = (
    r"(?:[a-z0-9]+[_-])?(?:password|passwd|pwd|secret|token|api[_-]?key|"
    r"access[_-]?key|access[_-]?token|client[_-]?secret)"
)
_PASSWORD = re.compile(
    r"(?i)\b" + _KEY + r"[\"']?\s*[:=]\s*"
    r"""(?:"(?P<double>[^"\r\n]*)"|'(?P<single>[^'\r\n]*)'|(?P<bare>[^\s"',;}{]+))"""
)
_SENSITIVE_KEY = re.compile(r"(?i)^" + _KEY + r"$")
_PEM = re.compile(r"-----BEGIN ([A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----")


@dataclass(frozen=True)
class Cleaned:
    body: bytes
    count: int
    kinds: tuple[str, ...]
    attachments: int = 0
    attachment_formats: tuple[str, ...] = ()


def clean(body: bytes) -> Cleaned:
    if len(body) > attachments.MAX_REQUEST_BYTES:
        raise ValueError("request_too_large")
    try:
        data = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise ValueError("invalid_json") from exc
    if not isinstance(data, dict) or not isinstance(data.get("messages"), list):
        raise ValueError("messages_required")
    count = 0
    kinds: set[str] = set()
    reader = attachments.AttachmentReader()
    text_bytes = 0

    def spans(text: str) -> list[tuple[int, int, str]]:
        found = []
        for finding in dlp.scan_text(text, entropy=True):
            if finding.category is dlp.Category.pii:
                continue
            if finding.rule == "private_key_pem":
                pem = _PEM.match(text, finding.start)
                if pem is None:
                    raise ValueError("incomplete_private_key")
                found.append((pem.start(), pem.end(), finding.rule))
            elif finding.rule != "generic_secret_assignment":
                found.append((finding.start, finding.end, finding.rule))
        for match in _PASSWORD.finditer(text):
            group = match.lastgroup
            if group and match.group(group) not in ("", "XXX"):
                found.append((match.start(group), match.end(group), "password_assignment"))
        # Merge overlaps so a broad detection never leaves a suffix behind.
        merged: list[tuple[int, int, str]] = []
        for start, end, rule in sorted(found):
            if merged and start < merged[-1][1]:
                a, b, r = merged[-1]
                merged[-1] = (a, max(b, end), r)
            else:
                merged.append((start, end, rule))
        return merged

    def visit(value: object, depth: int = 0) -> object:
        nonlocal count, text_bytes
        if depth > 40:
            raise ValueError("request_too_deep")
        if isinstance(value, str):
            text_bytes += len(value.encode("utf-8"))
            if text_bytes > MAX_BYTES:
                raise ValueError("request_too_large")
            parts: list[str] = []
            cursor = 0
            for start, end, kind in spans(value):
                if start < cursor:
                    continue
                parts.extend([value[cursor:start], "XXX"])
                cursor = end
                count += 1
                kinds.add(kind)
            parts.append(value[cursor:])
            text = "".join(parts)
            if spans(text):
                raise ValueError("redaction_incomplete")
            return text
        if isinstance(value, list):
            return [visit(item, depth + 1) for item in value]
        if isinstance(value, dict):
            block_type = value.get("type")
            if block_type in ("image", "document"):
                extracted = reader.read(value)
                # Preserve useful textual metadata but never the raw source,
                # citations, embedded resources or binary payload. The model sees
                # only what we can inspect and clean, not an unredacted original.
                metadata = []
                for field in ("title", "context"):
                    item = value.get(field)
                    if item is not None:
                        if not isinstance(item, str):
                            raise attachments.AttachmentError("attachment_invalid_metadata")
                        metadata.append(item)
                text = "[Attachment: text rendition; original omitted]\n"
                text += "\n".join([*metadata, extracted])
                return {"type": "text", "text": visit(text, depth + 1)}
            if block_type == "redacted_thinking":
                raise ValueError("attachments_not_supported")
            if block_type == "thinking":
                if not isinstance(value.get("thinking"), str) or spans(value["thinking"]):
                    raise ValueError("signed_thinking_cannot_be_redacted")
                return value
            result: dict[str, object] = {}
            for key, item in value.items():
                if _SENSITIVE_KEY.fullmatch(key) and isinstance(item, (str, int, float)):
                    result[key] = "XXX"
                    if item != "XXX":
                        count += 1
                        kinds.add("password_assignment")
                elif key in ("type", "role", "id", "tool_use_id", "name"):
                    # Protocol identifiers are not editable prompt text. Refuse a
                    # recognizable secret here rather than break tool references.
                    if isinstance(item, str) and any(
                        f.category is dlp.Category.secret for f in dlp.scan_text(item)
                    ):
                        raise ValueError("secret_in_protocol_identifier")
                    result[key] = item
                else:
                    result[key] = visit(item, depth + 1)
            return result
        return value

    # Decode before scanning: JSON escapes must not bypass the detector. Preserve
    # model names and tool schemas; inspect message/system values, including history.
    for field in ("messages", "system", "tools"):
        if field in data:
            data[field] = visit(data[field])
    cleaned = json.dumps(data, ensure_ascii=False).encode()
    if len(cleaned) > MAX_BYTES:
        raise ValueError("request_too_large")
    return Cleaned(
        cleaned, count, tuple(sorted(kinds)), reader.count, tuple(sorted(reader.formats))
    )
