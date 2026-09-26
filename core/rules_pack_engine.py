"""Le moteur du contrat « Règles sur mesure » : grammaire, détection, validité (§2 à §4).

Source normative : ``secret-guard/contracts/RULES-PACK.md`` (v1), avec son schéma et ses
vecteurs. Le poste applique le même contrat en TypeScript ; les deux côtés doivent rendre
les mêmes codes et les mêmes sous-chaînes sur ``fixtures/rules-pack-vectors.json``
(``tests/test_rules_pack_contract.py``).

**Bibliothèque standard seulement, et ce n'est pas un détail.** Un motif conforme à la
grammaire reste une expression à retour arrière : ``[a-z]{0,60}[a-z]{0,60}[a-z]{0,60}
[a-z]{0,60}XYZ`` est valide, et ``re`` met des secondes sur deux cents lettres, des heures
sur deux mille. ``re`` ne s'interrompt pas. La plateforme exécute donc les motifs d'un
paquet dans un processus qu'elle peut tuer (:func:`core.rules_packs.evaluate`), et ce
fichier est ce processus : ``python -I -S core/rules_pack_engine.py``. Aucune dépendance
tierce, aucun accès réseau, aucun fichier ouvert.

Ce module ne journalise rien : les textes qu'il reçoit (tests du paquet, texte d'essai de
l'opérateur) ne sortent que sous forme de positions.
"""

from __future__ import annotations

import base64
import functools
import hashlib
import json
import math
import re
import sys
import unicodedata
from dataclasses import dataclass
from typing import Any

#: Bornes de la grammaire (§3).
MAX_PATTERN_LENGTH = 256
MAX_GROUP_DEPTH = 4
MAX_REPEAT = 64
MIN_MATCH_LENGTH = 3
MAX_MATCH_LENGTH = 256
ANCHOR_LITERALS = 3
#: Total des empreintes de tous les détecteurs ``terms`` d'un paquet (§2.4).
MAX_TOTAL_DIGESTS = 20_000

#: Caractères qu'un ``\\`` rend littéraux, dans et hors classe (§3).
_ESCAPABLE = frozenset("\\^$.|?*+()[]{}-/")
_DIGITS = frozenset("0123456789")
_WORD = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_")
_SPACE = frozenset(" \t\n\r\f\v")
_SHORTHANDS = {"d": _DIGITS, "w": _WORD, "s": _SPACE}
_QUANTIFIER_START = frozenset("?*+{")
_BRACES = re.compile(r"(0|[1-9][0-9]{0,2})(?:(,)(0|[1-9][0-9]{0,2})?)?", re.ASCII)
#: Repli de casse ASCII seulement (§4) : ``str.lower`` replierait aussi « K » (Kelvin).
_ASCII_LOWER = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")


class PatternError(ValueError):
    """Un motif hors grammaire. ``code`` est l'un des codes de §3."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class PackError(ValueError):
    """Un paquet invalide (§2). ``code`` est l'un des codes de §2, plus ``schema``."""

    def __init__(
        self,
        code: str,
        *,
        detector: str | None = None,
        test: int | None = None,
        reason: str | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.detector = detector
        self.test = test
        self.reason = reason

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "detector": self.detector,
            "test": self.test,
            "reason": self.reason,
        }


# ---------------------------------------------------------------------------
# Grammaire (§3)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class CharSet:
    """Un atome qui consomme exactement un caractère parmi ``chars``."""

    chars: frozenset[str]
    #: Vrai pour un littéral ou un échappement littéral — ce que compte l'ancre (§3).
    literal: bool


@dataclass(frozen=True)
class Group:
    alternatives: tuple[tuple[Term, ...], ...]


@dataclass(frozen=True)
class Term:
    atom: CharSet | Group
    low: int
    high: int
    quantified: bool


Alternatives = tuple[tuple[Term, ...], ...]


class _Parser:
    """Lecture de gauche à droite ; la première anomalie rencontrée donne le code."""

    def __init__(self, text: str) -> None:
        self.text = text
        self.pos = 0

    def peek(self, offset: int = 0) -> str:
        index = self.pos + offset
        return self.text[index] if index < len(self.text) else ""

    def parse(self) -> Alternatives:
        alternatives = self.alternation(0)
        if self.pos < len(self.text):  # seul un ')' arrête le premier niveau
            raise PatternError("unbalanced_group")
        return alternatives

    def alternation(self, depth: int) -> Alternatives:
        alternatives = [self.sequence(depth)]
        while self.peek() == "|":
            self.pos += 1
            alternatives.append(self.sequence(depth))
        return tuple(alternatives)

    def sequence(self, depth: int) -> tuple[Term, ...]:
        terms: list[Term] = []
        while self.pos < len(self.text) and self.peek() not in ("|", ")"):
            terms.append(self.term(depth))
        if not terms:
            raise PatternError("empty_alternative")
        return tuple(terms)

    def term(self, depth: int) -> Term:
        atom = self.atom(depth)
        low, high, quantified = self.quantifier(atom)
        if quantified and self.peek() in _QUANTIFIER_START:
            raise PatternError("stacked_quantifier")
        return Term(atom, low, high, quantified)

    def atom(self, depth: int) -> CharSet | Group:
        char = self.peek()
        if char == "(":
            return self.group(depth)
        if char == "[":
            return self.char_class()
        if char == "\\":
            chars, single = self.escape()
            return CharSet(chars, literal=single is not None)
        if char == ".":
            raise PatternError("dot_not_allowed")
        if char in ("^", "$"):
            raise PatternError("anchor_not_allowed")
        if char in _QUANTIFIER_START:
            raise PatternError("dangling_quantifier")
        if char in ("]", "}"):
            raise PatternError("bad_literal")
        self.pos += 1
        return CharSet(frozenset(char), literal=True)

    def group(self, depth: int) -> Group:
        if not self.text.startswith("(?:", self.pos):
            raise PatternError("group_not_allowed")
        if depth + 1 > MAX_GROUP_DEPTH:
            raise PatternError("too_deep")
        self.pos += 3
        alternatives = self.alternation(depth + 1)
        if self.peek() != ")":
            raise PatternError("unbalanced_group")
        self.pos += 1
        return Group(alternatives)

    def escape(self) -> tuple[frozenset[str], str | None]:
        """``\\x`` : un littéral (et son caractère), ou une classe abrégée (et ``None``)."""
        following = self.peek(1)
        self.pos += 2
        if following and following in _ESCAPABLE:
            return frozenset(following), following
        if following in _SHORTHANDS:
            return _SHORTHANDS[following], None
        raise PatternError("bad_escape")

    def class_atom(self) -> tuple[frozenset[str], str | None]:
        char = self.peek()
        if char == "\\":
            return self.escape()
        if char in ("[", "^", "-"):
            raise PatternError("bad_class_char")
        self.pos += 1
        return frozenset(char), char

    def char_class(self) -> CharSet:
        self.pos += 1
        if self.peek() == "^":
            raise PatternError("negated_class")
        if self.peek() == "]":
            raise PatternError("empty_class")
        chars: set[str] = set()
        while True:
            char = self.peek()
            if char == "":
                raise PatternError("unbalanced_class")
            if char == "]":
                self.pos += 1
                return CharSet(frozenset(chars), literal=False)
            members, low = self.class_atom()
            if self.peek() == "-" and self.peek(1) not in ("]", ""):
                self.pos += 1
                _, high = self.class_atom()
                if low is None or high is None:
                    raise PatternError("bad_class_char")
                if ord(high) < ord(low):
                    raise PatternError("bad_range")
                chars.update(chr(code) for code in range(ord(low), ord(high) + 1))
            else:
                chars.update(members)

    def quantifier(self, atom: CharSet | Group) -> tuple[int, int, bool]:
        char = self.peek()
        if char == "?":
            self.pos += 1
            low, high = 0, 1
        elif char in ("*", "+"):
            raise PatternError("unbounded_quantifier")
        elif char == "{":
            low, high = self.braces()
        else:
            return 1, 1, False
        if high > 1 and isinstance(atom, Group) and _repeats_or_chooses(atom.alternatives):
            raise PatternError("nested_repetition")
        return low, high, True

    def braces(self) -> tuple[int, int]:
        close = self.text.find("}", self.pos)
        if close == -1:
            raise PatternError("bad_quantifier")
        found = _BRACES.fullmatch(self.text, self.pos + 1, close)
        if found is None:
            raise PatternError("bad_quantifier")
        self.pos = close + 1
        low = int(found.group(1))
        if found.group(2) is None:
            if not 1 <= low <= MAX_REPEAT:
                raise PatternError("bad_quantifier")
            return low, low
        if found.group(3) is None:
            raise PatternError("unbounded_quantifier")
        high = int(found.group(3))
        if not 1 <= high <= MAX_REPEAT or low > high:
            raise PatternError("bad_quantifier")
        return low, high


def _repeats_or_chooses(alternatives: Alternatives) -> bool:
    if len(alternatives) > 1:
        return True
    for term in alternatives[0]:
        if term.quantified:
            return True
        if isinstance(term.atom, Group) and _repeats_or_chooses(term.atom.alternatives):
            return True
    return False


def _lengths(alternatives: Alternatives) -> tuple[int, int]:
    bounds = [_sequence_lengths(sequence) for sequence in alternatives]
    return min(low for low, _ in bounds), max(high for _, high in bounds)


def _sequence_lengths(sequence: tuple[Term, ...]) -> tuple[int, int]:
    low_total = high_total = 0
    for term in sequence:
        low, high = (1, 1) if isinstance(term.atom, CharSet) else _lengths(term.atom.alternatives)
        low_total += low * term.low
        high_total += high * term.high
    return low_total, high_total


def _has_anchor(alternatives: Alternatives) -> bool:
    if len(alternatives) != 1:
        return False
    run = 0
    for term in alternatives[0]:
        if isinstance(term.atom, CharSet) and term.atom.literal and not term.quantified:
            run += 1
            if run >= ANCHOR_LITERALS:
                return True
        else:
            run = 0
    return False


def parse_pattern(pattern: str, *, has_context: bool) -> Alternatives:
    """L'arbre d'un motif conforme à §3, ou :class:`PatternError` avec le code attendu."""
    if len(pattern) > MAX_PATTERN_LENGTH:
        raise PatternError("length")
    if any(not " " <= char <= "~" for char in pattern):
        raise PatternError("invalid_character")
    alternatives = _Parser(pattern).parse()
    low, high = _lengths(alternatives)
    if low < MIN_MATCH_LENGTH:
        raise PatternError("too_short")
    if high > MAX_MATCH_LENGTH:
        raise PatternError("too_long")
    if not has_context and not _has_anchor(alternatives):
        raise PatternError("no_anchor")
    return alternatives


def pattern_error(pattern: str, *, has_context: bool) -> str | None:
    """Le code d'erreur de §3 pour ce motif, ou ``None`` s'il est valide."""
    try:
        parse_pattern(pattern, has_context=has_context)
    except PatternError as exc:
        return exc.code
    return None


# ---------------------------------------------------------------------------
# Traduction vers ``re`` (sémantique de §4 : premier choix, retour arrière)
# ---------------------------------------------------------------------------
def _render_set(chars: frozenset[str]) -> str:
    codes = sorted(ord(char) for char in chars)
    parts: list[str] = []
    index = 0
    while index < len(codes):
        start = end = codes[index]
        while index + 1 < len(codes) and codes[index + 1] == end + 1:
            index += 1
            end = codes[index]
        parts.append(f"\\x{start:02x}" if start == end else f"\\x{start:02x}-\\x{end:02x}")
        index += 1
    return "[" + "".join(parts) + "]"


def _render(alternatives: Alternatives) -> str:
    return "|".join("".join(_render_term(term) for term in sequence) for sequence in alternatives)


def _render_term(term: Term) -> str:
    if isinstance(term.atom, CharSet):
        body = _render_set(term.atom.chars)
    else:
        body = "(?:" + _render(term.atom.alternatives) + ")"
    if not term.quantified:
        return body
    if (term.low, term.high) == (0, 1):
        return body + "?"
    return f"{body}{{{term.low},{term.high}}}"


@functools.lru_cache(maxsize=512)
def compile_pattern(pattern: str, *, has_context: bool, case_insensitive: bool) -> re.Pattern[str]:
    """Le motif validé, développé en classes ASCII explicites (``\\d``, ``\\w``, ``\\s``)."""
    flags = re.ASCII | (re.IGNORECASE if case_insensitive else 0)
    return re.compile(_render(parse_pattern(pattern, has_context=has_context)), flags)


# ---------------------------------------------------------------------------
# Détection (§4)
# ---------------------------------------------------------------------------
def _entropy(text: str) -> float:
    counts: dict[str, int] = {}
    for char in text:
        counts[char] = counts.get(char, 0) + 1
    total = len(text)
    return -sum((count / total) * math.log2(count / total) for count in counts.values())


def _in_context(text: str, start: int, end: int, context: dict[str, Any] | None) -> bool:
    if context is None:
        return True
    window = int(context["window"])
    around = text[max(0, start - window) : min(len(text), end + window)].translate(_ASCII_LOWER)
    return any(str(keyword).translate(_ASCII_LOWER) in around for keyword in context["keywords"])


def _is_word_char(char: str) -> bool:
    return unicodedata.category(char)[0] in ("L", "N", "M")


def _normalize_word(word: str) -> str:
    decomposed = unicodedata.normalize("NFKD", word)
    return "".join(char for char in decomposed if unicodedata.category(char)[0] != "M").lower()


def words(text: str) -> list[tuple[int, int, str]]:
    """Les mots du texte (§4) : ``(début, fin, forme normalisée)``, mots vides ignorés."""
    found: list[tuple[int, int, str]] = []
    index, size = 0, len(text)
    while index < size:
        if not _is_word_char(text[index]):
            index += 1
            continue
        end = index + 1
        while end < size and _is_word_char(text[end]):
            end += 1
        normalized = _normalize_word(text[index:end])
        if normalized:
            found.append((index, end, normalized))
        index = end
    return found


def normalize_term(term: str) -> str:
    """La forme dont l'empreinte est calculée : mots normalisés joints par une espace."""
    return " ".join(normalized for _, _, normalized in words(term))


def term_digest(salt: bytes, normalized: str) -> str:
    return hashlib.sha256(salt + normalized.encode("utf-8")).hexdigest()


def _detect_pattern(detector: dict[str, Any], text: str) -> list[tuple[int, int]]:
    match = detector["match"]
    context = detector.get("context")
    regex = compile_pattern(
        match["pattern"],
        has_context=context is not None,
        case_insensitive=bool(match.get("caseInsensitive", False)),
    )
    threshold = match.get("minEntropyTenths")
    spans: list[tuple[int, int]] = []
    for found in regex.finditer(text):
        start, end = found.span()
        if threshold is not None and _entropy(found.group()) < threshold / 10:
            continue
        if _in_context(text, start, end, context):
            spans.append((start, end))
    return spans


def _detect_terms(detector: dict[str, Any], text: str) -> list[tuple[int, int]]:
    match = detector["match"]
    context = detector.get("context")
    salt = base64.b64decode(match["salt"], validate=True)
    digests = frozenset(match["digests"])
    max_words = int(match["maxWords"])
    found = words(text)
    candidates: list[tuple[int, int]] = []
    for first in range(len(found)):
        gram = ""
        for size in range(1, max_words + 1):
            last = first + size - 1
            if last >= len(found):
                break
            gram = found[last][2] if size == 1 else gram + " " + found[last][2]
            if term_digest(salt, gram) in digests:
                start, end = found[first][0], found[last][1]
                if _in_context(text, start, end, context):
                    candidates.append((start, end))
    candidates.sort(key=lambda span: (span[0], -span[1]))
    kept: list[tuple[int, int]] = []
    for start, end in candidates:
        if not kept or start >= kept[-1][1]:
            kept.append((start, end))
    return kept


def detect(detector: dict[str, Any], text: str) -> list[tuple[int, int]]:
    """Les détections d'un détecteur sur ``text``, en positions de points de code."""
    if detector["match"]["type"] == "pattern":
        return _detect_pattern(detector, text)
    return _detect_terms(detector, text)


# ---------------------------------------------------------------------------
# Validité d'un paquet (§2, étapes 2 à 9 ; l'étape 1 est le schéma)
# ---------------------------------------------------------------------------
def check_pack(payload: dict[str, Any]) -> None:
    """Les contrôles 2 à 9 de §2, dans l'ordre, sur un paquet conforme au schéma."""
    detectors: list[dict[str, Any]] = payload["detectors"]
    ids = [detector["id"] for detector in detectors]
    seen: set[str] = set()
    for detector_id in ids:
        if detector_id in seen:
            raise PackError("duplicate_detector", detector=detector_id)
        seen.add(detector_id)
    if not payload["expiresAt"] > payload["issuedAt"]:
        raise PackError("validity_window")
    total = sum(len(d["match"]["digests"]) for d in detectors if d["match"]["type"] == "terms")
    if total > MAX_TOTAL_DIGESTS:
        raise PackError("too_many_digests")
    for detector in detectors:
        if detector["match"]["type"] != "pattern":
            continue
        reason = pattern_error(
            detector["match"]["pattern"], has_context=detector.get("context") is not None
        )
        if reason is not None:
            raise PackError("invalid_pattern", detector=detector["id"], reason=reason)
    by_id = {detector["id"]: detector for detector in detectors}
    positives: list[dict[str, Any]] = payload["tests"]["positives"]
    for index, positive in enumerate(positives):
        if positive["detector"] not in by_id:
            raise PackError("unknown_test_detector", test=index, detector=positive["detector"])
    covered = {positive["detector"] for positive in positives}
    for detector in detectors:
        if detector["match"]["type"] == "pattern" and detector["id"] not in covered:
            raise PackError("missing_positive", detector=detector["id"])
    for index, positive in enumerate(positives):
        if not detect(by_id[positive["detector"]], positive["text"]):
            raise PackError("positive_not_detected", test=index, detector=positive["detector"])
    for index, negative in enumerate(payload["tests"]["negatives"]):
        for detector in detectors:
            if detect(detector, negative):
                raise PackError("negative_detected", test=index, detector=detector["id"])


def detect_all(payload: dict[str, Any], text: str) -> list[dict[str, Any]]:
    """Toutes les détections du paquet sur ``text`` — pour l'essai de l'opérateur."""
    found: list[dict[str, Any]] = []
    for detector in payload["detectors"]:
        for start, end in detect(detector, text):
            found.append({"detector": detector["id"], "start": start, "end": end})
    found.sort(key=lambda item: (item["start"], -item["end"], item["detector"]))
    return found


def evaluate(payload: dict[str, Any], sample: str | None) -> dict[str, Any]:
    """Validité du paquet, puis détections sur ``sample`` (si le paquet est exécutable).

    L'essai reste possible sur un paquet invalide pour une raison de tests (un positif
    manquant n'empêche pas de voir ce que détectent les motifs) ; il ne l'est pas quand un
    motif est hors grammaire, puisqu'il n'y a alors rien d'exécutable.
    """
    error: dict[str, Any] | None = None
    try:
        check_pack(payload)
    except PackError as exc:
        error = exc.as_dict()
    detections: list[dict[str, Any]] = []
    runnable = error is None or error["code"] not in (
        "duplicate_detector",
        "too_many_digests",
        "invalid_pattern",
    )
    if sample and runnable:
        detections = detect_all(payload, sample)
    return {"error": error, "detections": detections}


def main() -> None:
    """Point d'entrée du processus isolé : JSON sur stdin, JSON sur stdout, rien d'autre."""
    try:
        request = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        result = evaluate(request["payload"], request.get("sample"))
    except Exception:
        sys.stdout.write(json.dumps({"failure": "engine_failed"}))
        sys.exit(2)
    sys.stdout.write(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
