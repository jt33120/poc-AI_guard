"""Egress data-loss guard: block secrets / flag PII before text reaches an LLM.

This is the outbound (egress) complement to the action guard. On the LLM proxy's
*request* path we scan the outgoing prompt for:

  * **L0 — fixed-form secrets** (AWS keys, PEM private keys, GitHub/Stripe/OpenAI/
    Anthropic tokens, JWTs, …). These have a fixed shape, sometimes a checksum, so
    they are matched with high confidence and **blocked** by default.
  * **L2 — structured PII** (email, credit card [Luhn], IBAN [mod-97], French NIR
    [INSEE key]). Arithmetic validators cut false positives; **flagged** by default
    (observe, don't break the agent) — redaction is opt-in.
  * **L1 — high-entropy blobs** (possible unknown-format secrets). Noisy, so it is
    **off** by default and can only *flag*, never block.

Design honesty (CLAUDE.md §2 lists "PII stripping → V1.1" as an extension point):
only L0 is truly deterministic. Everything else is a detector on a precision/recall
curve, so precision is favoured on the hot path — a filter that blocks legitimate
traffic gets turned off. This stops *accidental* leakage (the common case), not a
determined exfiltrator (who can split/encode a secret across turns).

Never stores or logs the matched value — only its kind + a SHA-256 (CLAUDE.md
§4.10). Placeholders name the *kind*; ``value_sha256`` is for correlation only.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class Category(StrEnum):
    """What a finding is, which drives its default action."""

    secret = "secret"  # noqa: S105 - category name, not a credential
    pii = "pii"
    entropy = "entropy"


class Action(StrEnum):
    """What to do with a finding of a given category (most→least severe)."""

    block = "block"
    redact = "redact"
    flag = "flag"
    off = "off"


@dataclass(frozen=True)
class DlpPolicy:
    """Per-category action. Everything ``off`` means the scanner is a no-op."""

    secret: Action = Action.block
    pii: Action = Action.flag
    entropy: Action = Action.off

    def action_for(self, category: Category) -> Action:
        return {
            Category.secret: self.secret,
            Category.pii: self.pii,
            Category.entropy: self.entropy,
        }[category]

    @property
    def is_active(self) -> bool:
        return any(a is not Action.off for a in (self.secret, self.pii, self.entropy))


@dataclass(frozen=True)
class Finding:
    """One detected span. Carries the *kind* + a hash — never the raw value."""

    rule: str
    category: Category
    value_sha256: str
    start: int
    end: int

    @property
    def placeholder(self) -> str:
        return f"[REDACTED:{self.rule}]"


# --- Arithmetic validators (cut false positives on structured PII) -------------


def _luhn_ok(value: str) -> bool:
    digits = [int(c) for c in value if c.isdigit()]
    if not (13 <= len(digits) <= 19):
        return False
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _iban_ok(value: str) -> bool:
    s = re.sub(r"\s", "", value).upper()
    if not (15 <= len(s) <= 34) or not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]+", s):
        return False
    rearranged = s[4:] + s[:4]
    # A=10 … Z=35, digits stay themselves (int(c, 36)).
    digits = "".join(str(int(c, 36)) for c in rearranged)
    return int(digits) % 97 == 1


def _nir_ok(value: str) -> bool:
    """French social-security number: 13-digit body + 2-digit INSEE key."""
    s = re.sub(r"[\s.]", "", value).upper()
    if len(s) != 15:
        return False
    body, key = s[:13], s[13:]
    if not key.isdigit():
        return False
    # Corsica departments 2A/2B substitute to 19/18 before the checksum.
    numeric = body.replace("2A", "19").replace("2B", "18")
    if not numeric.isdigit():
        return False
    return int(key) == 97 - (int(numeric) % 97)


# --- Rule catalogue ------------------------------------------------------------


@dataclass(frozen=True)
class _Rule:
    name: str
    category: Category
    pattern: re.Pattern[str]
    validator: Callable[[str], bool] | None = None


def _rule(
    name: str, category: Category, pattern: str, validator: Callable[[str], bool] | None = None
) -> _Rule:
    return _Rule(name, category, re.compile(pattern), validator)


# L0 secrets first, most-specific prefixes ahead of broader ones (anthropic before
# openai) so overlap dedup keeps the precise label. PII last.
_RULES: tuple[_Rule, ...] = (
    _rule(
        "private_key_pem",
        Category.secret,
        r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----",
    ),
    _rule(
        "aws_access_key_id",
        Category.secret,
        r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|A3T[A-Z0-9])[A-Z0-9]{16}\b",
    ),
    _rule("github_pat_fine", Category.secret, r"\bgithub_pat_[A-Za-z0-9_]{82}\b"),
    _rule("github_token", Category.secret, r"\bgh[posru]_[A-Za-z0-9]{36}\b"),
    _rule("gitlab_pat", Category.secret, r"\bglpat-[A-Za-z0-9_\-]{20}\b"),
    _rule("slack_token", Category.secret, r"\bxox[baprs]-[A-Za-z0-9-]{10,72}\b"),
    _rule(
        "slack_webhook",
        Category.secret,
        r"https://hooks\.slack\.com/services/T[A-Za-z0-9_]+/B[A-Za-z0-9_]+/[A-Za-z0-9]+",
    ),
    _rule("stripe_secret_key", Category.secret, r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b"),
    _rule("google_api_key", Category.secret, r"\bAIza[0-9A-Za-z_\-]{35}\b"),
    _rule("google_oauth_token", Category.secret, r"\bya29\.[0-9A-Za-z_\-]{20,}\b"),
    _rule("sendgrid_key", Category.secret, r"\bSG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}\b"),
    _rule("twilio_api_key", Category.secret, r"\bSK[0-9a-fA-F]{32}\b"),
    _rule("twilio_account_sid", Category.secret, r"\bAC[0-9a-fA-F]{32}\b"),
    _rule("npm_token", Category.secret, r"\bnpm_[A-Za-z0-9]{36}\b"),
    _rule("mailgun_key", Category.secret, r"\bkey-[0-9a-f]{32}\b"),
    _rule("anthropic_key", Category.secret, r"\bsk-ant-(?:api03-)?[A-Za-z0-9_\-]{20,}\b"),
    _rule("openai_key", Category.secret, r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_\-]{20,}\b"),
    _rule(
        "jwt",
        Category.secret,
        r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b",
    ),
    _rule("basic_auth_url", Category.secret, r"\b[a-z][a-z0-9+.\-]*://[^\s:/@]+:[^\s:/@]+@"),
    # L2 structured PII (validated). Most-specific/checksummed first so overlap
    # dedup prefers the precise label over the generic Luhn card matcher.
    _rule("iban", Category.pii, r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b", _iban_ok),
    _rule(
        "fr_nir",
        Category.pii,
        r"\b[12] ?\d{2} ?(?:0[1-9]|1[0-2]|[2-9]\d) ?(?:\d{2}|2[AB]) ?\d{3} ?\d{3} ?\d{2}\b",
        _nir_ok,
    ),
    _rule("credit_card", Category.pii, r"\b\d(?:[ \-]?\d){12,18}\b", _luhn_ok),
    _rule("email", Category.pii, r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"),
)


# --- L1 entropy (opt-in) -------------------------------------------------------

_ENTROPY_TOKEN = re.compile(r"[A-Za-z0-9+/=_\-]{20,}")
_HEX = re.compile(r"\A[0-9a-fA-F]+\Z")
_UUID = re.compile(
    r"\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\Z"
)


def _shannon(s: str) -> float:
    n = len(s)
    return -sum((c / n) * math.log2(c / n) for c in Counter(s).values())


def _is_boring(token: str) -> bool:
    """Common high-entropy-but-safe shapes we must NOT flag (kills false positives)."""
    if _UUID.match(token):
        return True
    # md5 / sha1 / sha256 / sha512 hex digests.
    return bool(_HEX.match(token)) and len(token) in (32, 40, 64, 128)


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _overlaps(start: int, end: int, spans: list[tuple[int, int]]) -> bool:
    return any(not (end <= s or start >= e) for s, e in spans)


def _entropy_findings(text: str, covered: list[Finding]) -> list[Finding]:
    spans = [(f.start, f.end) for f in covered]
    out: list[Finding] = []
    for m in _ENTROPY_TOKEN.finditer(text):
        token = m.group(0)
        if _is_boring(token) or _overlaps(m.start(), m.end(), spans):
            continue
        # Hex alphabet is smaller, so it plateaus lower; use a lower bar for it.
        threshold = 3.0 if _HEX.match(token) else 4.5
        if _shannon(token) >= threshold:
            out.append(Finding("high_entropy", Category.entropy, _sha(token), m.start(), m.end()))
    return out


def _dedupe_overlaps(findings: list[Finding]) -> list[Finding]:
    """Keep the earliest, then longest, then earliest-declared finding per span."""
    order = sorted(
        range(len(findings)),
        key=lambda i: (findings[i].start, -(findings[i].end - findings[i].start), i),
    )
    kept: list[Finding] = []
    spans: list[tuple[int, int]] = []
    for i in order:
        f = findings[i]
        if _overlaps(f.start, f.end, spans):
            continue
        kept.append(f)
        spans.append((f.start, f.end))
    kept.sort(key=lambda f: f.start)
    return kept


def scan_text(text: str, *, entropy: bool = False) -> list[Finding]:
    """All secret/PII (and optionally entropy) findings in ``text``, de-overlapped."""
    findings: list[Finding] = []
    for rule in _RULES:
        for m in rule.pattern.finditer(text):
            value = m.group(0)
            if rule.validator is not None and not rule.validator(value):
                continue
            findings.append(Finding(rule.name, rule.category, _sha(value), m.start(), m.end()))
    if entropy:
        findings.extend(_entropy_findings(text, findings))
    return _dedupe_overlaps(findings)


def redact_text(text: str, findings: list[Finding]) -> str:
    """Replace each finding span with its kind placeholder (JSON-string safe)."""
    parts: list[str] = []
    cursor = 0
    for f in sorted(findings, key=lambda f: f.start):
        if f.start < cursor:  # already covered by a previous (overlapping) span
            continue
        parts.append(text[cursor : f.start])
        parts.append(f.placeholder)
        cursor = f.end
    parts.append(text[cursor:])
    return "".join(parts)


# --- Request-level scan --------------------------------------------------------

# Cap the scanned prefix so a pathological body can't stall the hot path. The
# remainder (if any) is forwarded unscanned and ``truncated`` says so — no silent
# cap (CLAUDE.md §5: explicit).
_MAX_SCAN = 2_000_000


@dataclass(frozen=True)
class ScanResult:
    findings: list[Finding]
    blocked: bool
    redacted_body: bytes | None
    truncated: bool

    @property
    def kinds(self) -> list[str]:
        return sorted({f.rule for f in self.findings})

    @property
    def decision(self) -> str:
        if self.blocked:
            return "deny"
        return "redacted" if self.redacted_body is not None else "flag"

    def digest(self) -> str:
        """Stable correlation hash over the finding hashes (never the values)."""
        return hashlib.sha256(
            ",".join(sorted(f.value_sha256 for f in self.findings)).encode()
        ).hexdigest()

    def summary(self) -> dict[str, Any]:
        by_category: dict[str, int] = {}
        for f in self.findings:
            by_category[f.category.value] = by_category.get(f.category.value, 0) + 1
        return {"kinds": self.kinds, "by_category": by_category, "truncated": self.truncated}


_EMPTY = ScanResult(findings=[], blocked=False, redacted_body=None, truncated=False)


def scan_request(body: bytes, policy: DlpPolicy) -> ScanResult:
    """Scan an outbound request body and resolve the DLP verdict for ``policy``.

    ``block`` wins over ``redact`` wins over ``flag``. Only the redact path
    rebuilds the body; block returns no body (caller refuses) and flag forwards
    the original bytes unchanged.
    """
    if not policy.is_active:
        return _EMPTY
    text = body.decode("utf-8", "replace")
    truncated = len(text) > _MAX_SCAN
    head = text[:_MAX_SCAN] if truncated else text
    tail = text[_MAX_SCAN:] if truncated else ""

    findings = scan_text(head, entropy=policy.entropy is not Action.off)
    effective = [f for f in findings if policy.action_for(f.category) is not Action.off]
    if not effective:
        return ScanResult([], False, None, truncated)

    if any(policy.action_for(f.category) is Action.block for f in effective):
        return ScanResult(effective, True, None, truncated)

    to_redact = [f for f in effective if policy.action_for(f.category) is Action.redact]
    redacted_body: bytes | None = None
    if to_redact:
        redacted_body = (redact_text(head, to_redact) + tail).encode("utf-8")
    return ScanResult(effective, False, redacted_body, truncated)


def policy_from_settings(settings: Any) -> DlpPolicy:
    """Build the runtime DLP policy from settings (all-off when disabled)."""
    if not settings.dlp_enabled:
        return DlpPolicy(secret=Action.off, pii=Action.off, entropy=Action.off)
    return DlpPolicy(
        secret=Action(settings.dlp_secret_action),
        pii=Action(settings.dlp_pii_action),
        entropy=Action(settings.dlp_entropy_action),
    )
