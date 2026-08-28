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

import base64
import binascii
import html
import json
import re
import unicodedata
import urllib.parse
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from core import dlp

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


#: Charges exécutables planquées dans un résultat d'outil (`FR-186`, `M-13`).
#:
#: Le périmètre est délibérément étroit. `<script>` seul **n'en fait pas partie** :
#: une page web récupérée en contient presque toujours, et une garde qui teinte
#: chaque `fetch` est une panne, pas un contrôle — c'est la même discipline de faux
#: positifs que `FR-153`. Ne restent que des formes rarement innocentes *dans un
#: résultat d'outil* : un tube vers un interpréteur, une URI `data:` porteuse de HTML,
#: un shebang, un `eval`/`exec` sur une chaîne.
_EXECUTABLE = re.compile(
    r"\b(?:curl|wget)\b[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:ba|z|k|d)?sh\b"
    r"|data:text/html"
    r"|\A#!\s*/\S*(?:sh|bash|python|perl|ruby)\b"
    r"|\b(?:eval|exec)\s*\(\s*[\"']"
    r"|<\s*script\b[^>]*>\s*(?:[^<]{0,400}?)"
    r"(?:fetch\s*\(|XMLHttpRequest|sendBeacon)",
    re.I | re.M,
)

#: Un blob base64 assez long pour porter quelque chose.
_B64 = re.compile(r"[A-Za-z0-9+/]{40,}={0,2}")


def _decoded_payload(text: str) -> bool:
    """Un blob base64 qui *décode* vers une charge exécutable.

    Encoder est la façon la moins chère de casser un motif sans rien changer à ce que
    la charge fait une fois décodée. Flaguer le base64 en lui-même serait inutilisable
    — une pièce jointe, une image, un PDF en portent tous — donc on décode et on
    re-teste. Une image décode vers du binaire, pas vers `curl … | bash` : le signal
    reste étroit et l'évasion est fermée.
    """
    for m in _B64.finditer(text):
        blob = m.group(0)
        try:
            clair = base64.b64decode(blob + "=" * (-len(blob) % 4), validate=True)
        except (ValueError, binascii.Error):
            continue
        try:
            lisible = clair.decode("utf-8")
        except UnicodeDecodeError:
            continue  # binaire : une image, pas un script
        if _EXECUTABLE.search(lisible):
            return True
    return False


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
    # `FR-186` / `M-13` : le canal du taint porte déjà le résultat, donc la détection
    # de charge exécutable s'y branche plutôt que d'ouvrir un second chemin.
    normalise = _normalise(text)
    if _EXECUTABLE.search(normalise) or _decoded_payload(normalise):
        return "executable_payload"
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


#: Une destination sortante dans les arguments d'une action post-taint (`FR-185`).
#:
#: Un hôte local n'en est pas une : le périmètre de l'exploitant n'est pas une fuite,
#: et gater dessus rendrait la garde bruyante là où elle doit être tranchante.
_URL = re.compile(r"\bhttps?://([^\s/:?#\"']+)", re.I)
# S104 vise une *écoute* sur toutes les interfaces ; ici la chaîne est une entrée
# de liste d'exclusion — on refuse de considérer ces hôtes comme une fuite.
_LOCAL = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0"})  # noqa: S104


def exfiltration_target(arguments: Mapping[str, Any]) -> str | None:
    """Le nom de la forme d'exfiltration trouvée dans ces arguments, ou `None`.

    `FR-185` : *une cible en forme d'exfiltration dans les arguments d'une action
    postérieure à un taint élève le verdict.* La DLP entre donc dans la décision — elle
    ne devient pas un produit à part (non-objectif v2 §5.4), elle est une **entrée**.

    Les e-mails viennent des détecteurs du produit (`core/dlp.py`), pas d'un second jeu
    de motifs : deux jeux divergent, et le jour où ils divergent le produit signale
    chez un client ce qu'il laisse passer chez lui.

    Le coût en faux positifs est borné par construction : ceci ne s'applique qu'à une
    session **déjà teintée**, c'est-à-dire après qu'une injection a été détectée dans
    un résultat. Dans cet état, gater une URL sortante est la bonne asymétrie.
    """
    texte = json.dumps(arguments, default=str)
    for m in _URL.finditer(texte):
        if m.group(1).split(":")[0].lower() not in _LOCAL:
            return "url_sortante"
    if any(f.rule == "email" for f in dlp.scan_text(texte)):
        return "adresse_email"
    return None
