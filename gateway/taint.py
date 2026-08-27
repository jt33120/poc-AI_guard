"""Indirect prompt-injection taint tracking at the action boundary (M12, axis D).

xSOM is not a prompt firewall — it watches *actions*. When a tool RESULT carries
content that looks like injected instructions or exfiltration (a fetched web
page, a document, an email body), the session is marked *tainted*. A subsequent
irreversible / external-send action within the taint window is then gated
(escalated to a human or denied, per policy) — an indirect-injection payload can
carry the agent up to the edge of a risky action, but not through it.

Scans content for signals only; never stores it (CLAUDE.md §4.10). Pure and
deterministic — no LLM on the path.
"""

from __future__ import annotations

import html
import re
import unicodedata
import urllib.parse
from dataclasses import dataclass

#: Invisible / bidi control chars used to smuggle instructions into a result.
_INVISIBLE = re.compile("[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]")

#: Letters from other scripts that read as Latin ones. Folded before matching, so
#: `Ignоre` with a Cyrillic `о` is the same string as `Ignore` to the patterns.
#: Folding alone is never a signal -- legitimate content is written in these
#: scripts. It only matters when the folded text then matches an injection.
_HOMOGLYPHS = str.maketrans(
    {
        # Cyrillic
        "а": "a",
        "в": "b",
        "е": "e",
        "к": "k",
        "м": "m",
        "н": "h",
        "о": "o",
        "р": "p",
        "с": "c",
        "т": "t",
        "у": "y",
        "х": "x",
        "і": "i",
        "ј": "j",
        "ѕ": "s",
        "ԁ": "d",
        "һ": "h",
        "ӏ": "l",
        "А": "A",
        "В": "B",
        "Е": "E",
        "К": "K",
        "М": "M",
        "Н": "H",
        "О": "O",
        "Р": "P",
        "С": "C",
        "Т": "T",
        "У": "Y",
        "Х": "X",
        "І": "I",
        # Greek
        "α": "a",
        "ε": "e",
        "ι": "i",
        "κ": "k",
        "μ": "m",
        "ν": "v",
        "ο": "o",
        "ρ": "p",
        "τ": "t",
        "υ": "u",
        "χ": "x",
        "Α": "A",
        "Β": "B",
        "Ε": "E",
        "Η": "H",
        "Ι": "I",
        "Κ": "K",
        "Μ": "M",
        "Ν": "N",
        "Ο": "O",
        "Ρ": "P",
        "Τ": "T",
        "Υ": "Y",
        "Χ": "X",
    }
)


def _normalise(text: str) -> str:
    """Fold a result into the form the patterns are written against (`FR-153`).

    Every step here exists because it is a way an attacker breaks a regex without
    changing what a model reads: an HTML entity in a fetched page, a percent-escape,
    a zero-width space mid-word, a full-width letter, a Cyrillic lookalike, an accent.
    The patterns are therefore written unaccented and lower-ASCII, once, instead of
    once per evasion.
    """
    text = html.unescape(text)
    text = urllib.parse.unquote(text)
    text = _INVISIBLE.sub("", text)
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\u2019", "'").replace("\u2018", "'")
    text = text.translate(_HOMOGLYPHS)
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


#: Instructions an attacker plants in fetched content to redirect the agent.
#:
#: English, French, Spanish, German (`FR-153`). The relay/forward patterns require
#: an object pronoun in every language -- `forward this`, `transfere tout`, `leite
#: alles ... weiter` -- so that a legitimate "le dossier a ete transfere au service"
#: or "wir leiten Ihre Anfrage weiter" does not gate an action. The English pattern
#: set that of the bar; the others mirror it rather than inventing a stricter or
#: looser standard per language.
_INJECT = re.compile(
    # --- English --------------------------------------------------------------
    r"ignore\s+(?:all\s+)?(?:previous|prior|above)"
    r"|disregard\s+(?:the\s+)?(?:previous|prior|above|instruction)"
    r"|forward\s+(?:this|it|all|everything|the)\b"
    r"|send\s+(?:all|everything|the\s+\w+)\b.{0,40}\bto\b"
    r"|exfiltrat"
    r"|you\s+are\s+now\b"
    r"|new\s+instructions?\s*:"
    r"|do\s+not\s+(?:tell|inform|mention\s+to)\s+the\s+user"
    # --- French ---------------------------------------------------------------
    r"|ignor(?:e|ez|er)\s+(?:tout(?:es)?\s+)?(?:les\s+)?(?:instructions?|consignes?)"
    r"|ne\s+(?:tiens|tenez)\s+pas\s+compte"
    r"|oubli(?:e|ez)\s+(?:tout(?:es)?\s+)?(?:les\s+)?(?:instructions?|consignes?|ce\s+qui)"
    r"|nouvelles?\s+instructions?\s*:"
    r"|(?:tu\s+es|vous\s+etes)\s+(?:maintenant|desormais)\b"
    r"|(?:transfere|transferez|transmets|transmettez)\s+(?:tout|tous|ceci|cela|ca|le|la|les|l')"
    r"|envoi(?:e|ez)\s+(?:tout|tous|le|la|les)\b.{0,40}\b(?:a|vers)\b"
    r"|n'?\s*(?:informe|previen|dis|parle)\w*\s+pas\b.{0,25}\butilisateur"
    # --- Spanish --------------------------------------------------------------
    r"|ignor(?:a|e|en|ad)\s+(?:todas?\s+)?(?:las\s+)?(?:instrucciones|indicaciones)"
    r"|no\s+teng(?:as|a|an)\s+en\s+cuenta"
    r"|olvid(?:a|e|en)\s+(?:las\s+)?(?:instrucciones|todo)"
    r"|nuevas?\s+instrucciones\s*:"
    r"|ahora\s+eres\b"
    r"|reenvi(?:a|e|en)\s+(?:todo|todos|esto|el|la|los)\b"
    r"|envi(?:a|e|en)\s+(?:todo|todos|el|la|los)\b.{0,40}\ba\b"
    r"|no\s+(?:le\s+)?(?:digas|diga|informes|informe)\b.{0,25}\busuario"
    # --- German ---------------------------------------------------------------
    r"|ignorier(?:e|en|t)\s+(?:alle\s+)?"
    r"(?:vorherigen|vorigen|obigen|bisherigen)?\s*(?:anweisung|anweisungen|hinweise)"
    r"|vergiss\s+(?:die\s+)?(?:anweisungen|alles)"
    r"|neue\s+anweisungen\s*:"
    r"|du\s+bist\s+jetzt\b"
    r"|leite\s+(?:alles|alle|dies|das|es)\b.{0,40}\bweiter\b"
    r"|send(?:e|et)\s+(?:alles|alle)\b.{0,40}\ban\b"
    r"|(?:sag|sage|informier)\w*\s+(?:dem|den)\s+(?:benutzer|nutzer|anwender)"
    r"\s+(?:\w+\s+){0,3}nicht\b",
    re.I | re.S,
)


def taints_result(text: str | None) -> str | None:
    """Return a short reason if a tool result looks like it carries an injection."""
    if not text:
        return None
    # Reported on the RAW text: smuggling characters are themselves the signal, and
    # normalisation removes them.
    if _INVISIBLE.search(text):
        return "invisible_characters"
    if _INJECT.search(_normalise(text)):
        return "injected_instructions"
    return None


@dataclass
class TaintState:
    """Per-session taint: the call sequence at which the last taint was observed."""

    tainted_at: int | None = None
    source_tool: str | None = None
    reason: str | None = None

    def mark(self, *, call_seq: int, source_tool: str, reason: str) -> None:
        self.tainted_at = call_seq
        self.source_tool = source_tool
        self.reason = reason

    def active(self, *, call_seq: int, window: int) -> bool:
        """Whether a taint observed earlier still covers the current call."""
        if self.tainted_at is None:
            return False
        return 0 < call_seq - self.tainted_at <= window
