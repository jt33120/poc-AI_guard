"""Règles sur mesure xSOM, côté plateforme (RULES-PACK.md §1, §2, §6, §7).

Un opérateur xSOM compose le réglage d'un client ; la plateforme le valide, en calcule
les empreintes, le signe avec la clé d'autorité xSOM et le conserve en ajout seul. Le
poste le vérifie hors ligne et l'applique localement. Le client lit son réglage, il ne
l'écrit pas : aucune route tenant ne mène ici en écriture.

**Ce qui n'est jamais conservé.** Les termes confidentiels saisis en clair servent à
calculer les empreintes et à vérifier qu'ils sont tous détectés, puis sont oubliés : ni
colonne, ni journal, ni message d'erreur ne les porte. Le texte d'essai de l'opérateur ne
sort que sous forme de positions.

**Pourquoi un processus isolé.** Voir :mod:`core.rules_pack_engine` : un motif conforme
peut faire tourner ``re`` pendant des heures. Tout ce qui exécute un motif passe par
:func:`evaluate`, qui tue le calcul au-delà de :data:`TIMEOUT_SECONDS` et refuse
(``budget_exceeded``) plutôt que de signer ce qu'il n'a pas fini de vérifier.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import subprocess
import sys
import threading
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any, Literal

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from core import audit
from core import rules_pack_engine as engine
from core.checkpoints import CheckpointError, Ed25519Signer
from core.config import Settings

if TYPE_CHECKING:  # pragma: no cover - psycopg n'est qu'un type ici
    import psycopg

SCHEMA_VERSION = 1
KIND = "xsom.secret-guard.rules-pack"
ISSUER = "xSOM"
#: Borne du calcul isolé : validité complète d'un paquet de taille maximale, avec marge.
TIMEOUT_SECONDS = 8.0
#: Texte d'essai de l'opérateur. Le poste analyse jusqu'à 1 Mio ; l'essai n'en a pas besoin.
MAX_SAMPLE_CHARS = 20_000
#: Un terme saisi : un nom de code, un nom de client, pas un paragraphe.
MAX_TERM_CHARS = 120
MAX_TERM_WORDS = 4
_WORKERS = threading.BoundedSemaphore(2)
_ENGINE = Path(engine.__file__).resolve()

_ID = r"^[a-z0-9][a-z0-9._-]{0,63}$"
_TS = r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
_KEYWORD = r"^[A-Za-z0-9][A-Za-z0-9 _.@:/-]{1,39}$"
_SALT = r"^(?:[A-Za-z0-9+/]{22}==|[A-Za-z0-9+/]{43}=)$"
_HEX64 = r"^[0-9a-f]{64}$"
Category = Literal["credential", "customer_data", "personal_data", "internal_infra", "project"]
Action = Literal["warn", "block"]


class RulesPackError(ValueError):
    """Refus de la plateforme. ``code`` est un code du contrat ou de ce module."""

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


class SigningUnavailable(RulesPackError):
    """Aucune clé d'autorité configurée : la publication échoue fermée (503)."""


class VersionConflict(RulesPackError):
    """La version attendue n'est plus la dernière publiée (409)."""


# ---------------------------------------------------------------------------
# Étape 1 : le schéma (rules-pack.schema.json), en validation seule
# ---------------------------------------------------------------------------
class _Schema(BaseModel):
    """Aucun champ du schéma n'admet ``null`` ; la forme validée n'est jamais redécoupée."""

    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=False)

    @model_validator(mode="before")
    @classmethod
    def _no_null(cls, data: Any) -> Any:
        if isinstance(data, dict) and any(value is None for value in data.values()):
            raise ValueError("null is not allowed")
        return data


class _Context(_Schema):
    keywords: list[Annotated[str, Field(pattern=_KEYWORD)]] = Field(min_length=1, max_length=20)
    window: int = Field(ge=1, le=256)

    @model_validator(mode="after")
    def _unique(self) -> _Context:
        if len(set(self.keywords)) != len(self.keywords):
            raise ValueError("keywords must be unique")
        return self


class _PatternMatch(_Schema):
    type: Literal["pattern"]
    pattern: str = Field(min_length=1, max_length=256)
    case_insensitive: bool = Field(default=False, alias="caseInsensitive")
    min_entropy_tenths: int = Field(default=0, ge=0, le=80, alias="minEntropyTenths")


class _TermsMatch(_Schema):
    type: Literal["terms"]
    salt: str = Field(pattern=_SALT)
    digests: list[Annotated[str, Field(pattern=_HEX64)]] = Field(min_length=1, max_length=5000)
    max_words: int = Field(ge=1, le=4, alias="maxWords")

    @model_validator(mode="after")
    def _unique(self) -> _TermsMatch:
        if len(set(self.digests)) != len(self.digests):
            raise ValueError("digests must be unique")
        return self


class _Detector(_Schema):
    id: str = Field(pattern=_ID)
    label: str = Field(min_length=1, max_length=80)
    category: Category
    action: Action
    match: _PatternMatch | _TermsMatch = Field(discriminator="type")
    context: _Context | None = None


class _Positive(_Schema):
    detector: str = Field(pattern=_ID)
    text: str = Field(min_length=1, max_length=2000)


class _Tests(_Schema):
    positives: list[_Positive] = Field(max_length=200)
    negatives: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(max_length=200)


class _Payload(_Schema):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    kind: Literal["xsom.secret-guard.rules-pack"]
    pack_id: str = Field(alias="packId", pattern=_ID)
    tenant_id: str = Field(alias="tenantId", min_length=1, max_length=128)
    version: int = Field(ge=1, le=2_147_483_647)
    issued_at: str = Field(alias="issuedAt", pattern=_TS)
    expires_at: str = Field(alias="expiresAt", pattern=_TS)
    issuer: str = Field(min_length=1, max_length=80)
    detectors: list[_Detector] = Field(min_length=1, max_length=200)
    tests: _Tests


def _storable(value: Any) -> bool:
    """Chaque chaîne s'encode en UTF-8 et entre dans ``jsonb`` (ni NUL, ni surrogat isolé)."""
    if isinstance(value, str):
        return "\x00" not in value and not any("\ud800" <= char <= "\udfff" for char in value)
    if isinstance(value, dict):
        return all(_storable(key) and _storable(item) for key, item in value.items())
    if isinstance(value, list):
        return all(_storable(item) for item in value)
    return True


def has_invisible(text: str) -> bool:
    """Caractère de contrôle ou de format (bidi, zéro chasse) : rien à faire dans un libellé.

    Un libellé s'affiche sur le poste à côté d'un envoi bloqué ; un contrôle bidi peut y
    faire lire autre chose que ce qui est signé.
    """
    return any(unicodedata.category(char) in ("Cc", "Cf") for char in text)


def has_unassigned(text: str) -> bool:
    """Un point de code que la table Unicode de ce Python ne connaît pas (catégorie Cn).

    Le contrat ne fixe pas de version d'Unicode, et le poste suit celle de son moteur
    JavaScript, plus récente que celle de Python : un caractère encore non attribué ici
    peut être une lettre là-bas. Les mots d'un texte qui en contient ne se découpent donc
    pas pareil des deux côtés, et un paquet que la plateforme a éprouvé pourrait échouer
    sur le poste. On refuse ce qu'on ne sait pas lire à l'identique.
    """
    return any(unicodedata.category(char) == "Cn" for char in text)


def check_schema(payload: Any) -> None:
    """Étape 1 de §2. Un booléen n'est pas un entier, un flottant non plus (§1)."""
    if not isinstance(payload, dict) or not _storable(payload) or _has_bool_or_float(payload):
        raise RulesPackError("schema")
    try:
        _Payload.model_validate(payload)
    except ValidationError:
        raise RulesPackError("schema") from None
    for detector in payload["detectors"]:
        if has_invisible(detector["label"]) or has_unassigned(detector["label"]):
            raise RulesPackError("schema", detector=detector["id"], reason="label")
    tests = payload["tests"]
    for index, positive in enumerate(tests["positives"]):
        if has_unassigned(positive["text"]):
            raise RulesPackError("unassigned_character", test=index)
    for index, negative in enumerate(tests["negatives"]):
        if has_unassigned(negative):
            raise RulesPackError("unassigned_character", test=index)


def _has_bool_or_float(value: Any, key: str | None = None) -> bool:
    if isinstance(value, float):
        return True
    if isinstance(value, bool):
        return key != "caseInsensitive"
    if isinstance(value, dict):
        return any(_has_bool_or_float(item, name) for name, item in value.items())
    if isinstance(value, list):
        return any(_has_bool_or_float(item) for item in value)
    return False


# ---------------------------------------------------------------------------
# Étapes 2 à 9, dans un processus qu'on peut tuer
# ---------------------------------------------------------------------------
#: Réponse du moteur au plus : 1 000 détections tiennent largement dedans.
MAX_ENGINE_OUTPUT = 1_000_000


@dataclass(frozen=True)
class Evaluation:
    error: dict[str, Any] | None
    detections: list[dict[str, Any]]
    truncated: bool = False


def evaluate(payload: dict[str, Any], sample: str | None = None) -> Evaluation:
    """Validité complète (§2) et, si demandé, détections sur ``sample`` — borné en temps.

    Le schéma est vérifié ici, dans le processus ; tout ce qui exécute un motif l'est
    dans le moteur isolé. Un dépassement, un plantage ou une réponse illisible donnent un
    refus : la plateforme ne signe jamais un paquet qu'elle n'a pas fini d'éprouver.
    """
    check_schema(payload)
    if sample is not None and (len(sample) > MAX_SAMPLE_CHARS or not _storable(sample)):
        raise RulesPackError("sample_too_large")
    if not _WORKERS.acquire(timeout=TIMEOUT_SECONDS):
        raise RulesPackError("engine_busy")
    try:
        # Ni identifiants, ni configuration utilisateur, ni PYTHONPATH : stdlib seule.
        env = {key: os.environ[key] for key in ("SystemRoot", "TEMP", "TMP") if key in os.environ}
        result = subprocess.run(  # noqa: S603 -- interpréteur et script fixés, sans shell
            [sys.executable, "-I", "-S", str(_ENGINE)],
            input=json.dumps({"payload": payload, "sample": sample}).encode("ascii"),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=TIMEOUT_SECONDS,
            check=False,
            env=env,
        )
    except subprocess.TimeoutExpired:
        raise RulesPackError("budget_exceeded") from None
    except OSError:
        raise RulesPackError("engine_failed") from None
    finally:
        _WORKERS.release()
    return _read_engine(result)


def _read_engine(result: subprocess.CompletedProcess[bytes]) -> Evaluation:
    if len(result.stdout) > MAX_ENGINE_OUTPUT:
        raise RulesPackError("engine_failed")
    try:
        answer = json.loads(result.stdout)
    except ValueError:
        raise RulesPackError("engine_failed") from None
    if result.returncode != 0 or not isinstance(answer, dict) or "detections" not in answer:
        raise RulesPackError("engine_failed")
    error = answer.get("error")
    detections = answer["detections"]
    if (error is not None and not isinstance(error, dict)) or not isinstance(detections, list):
        raise RulesPackError("engine_failed")
    return Evaluation(error=error, detections=detections, truncated=answer.get("truncated") is True)


def validate(payload: dict[str, Any]) -> None:
    """Lever :class:`RulesPackError` avec le code du contrat si le paquet est invalide."""
    evaluation = evaluate(payload)
    if evaluation.error is not None:
        error = evaluation.error
        raise RulesPackError(
            str(error.get("code")),
            detector=error.get("detector"),
            test=error.get("test"),
            reason=error.get("reason"),
        )


# ---------------------------------------------------------------------------
# §1 : forme canonique, empreinte, signature
# ---------------------------------------------------------------------------
def canonical(payload: dict[str, Any]) -> bytes:
    """JSON UTF-8, clés triées, sans espace, non ASCII tel quel (= ``JSON.stringify``)."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


def payload_digest(payload: dict[str, Any]) -> str:
    return hashlib.sha256(canonical(payload)).hexdigest()


def signer(settings: Settings) -> Ed25519Signer:
    """La clé d'autorité xSOM, ou :class:`SigningUnavailable` (publication fermée)."""
    raw = settings.xsom_rules_signing_key
    if not raw:
        raise SigningUnavailable("signing_unavailable")
    try:
        return Ed25519Signer(base64.b64decode(raw, validate=True))
    except (ValueError, TypeError, CheckpointError):
        raise SigningUnavailable("signing_unavailable") from None


def envelope(payload: dict[str, Any], signing: Ed25519Signer) -> dict[str, Any]:
    signature = base64.b64encode(signing.sign(canonical(payload))).decode("ascii")
    return {"payload": payload, "keyId": signing.key_id, "signature": signature}


def verify_envelope(document: dict[str, Any], public_keys: dict[str, bytes]) -> bool:
    """Ce que fait le poste (§1) : la clé vient de sa liste, jamais de l'enveloppe."""
    raw = public_keys.get(str(document.get("keyId")))
    payload = document.get("payload")
    if raw is None or not isinstance(payload, dict):
        return False
    try:
        signature = base64.b64decode(str(document.get("signature")), validate=True)
        Ed25519PublicKey.from_public_bytes(raw).verify(signature, canonical(payload))
    except (InvalidSignature, ValueError, TypeError):
        return False
    return True


# ---------------------------------------------------------------------------
# La composition de l'opérateur (clair) → la charge utile (empreintes)
# ---------------------------------------------------------------------------
class ContextDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    keywords: list[Annotated[str, Field(pattern=_KEYWORD)]] = Field(min_length=1, max_length=20)
    window: int = Field(ge=1, le=256)


class PatternDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    type: Literal["pattern"]
    pattern: str = Field(min_length=1, max_length=256)
    case_insensitive: bool = Field(default=False, alias="caseInsensitive")
    min_entropy_tenths: int | None = Field(default=None, ge=0, le=80, alias="minEntropyTenths")


class TermsDraft(BaseModel):
    """``terms`` absent : reprendre les empreintes publiées sous le même ``id``."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["terms"]
    terms: list[Annotated[str, Field(min_length=1, max_length=MAX_TERM_CHARS)]] | None = Field(
        default=None, max_length=5000, repr=False
    )


class DetectorDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=_ID)
    label: str = Field(min_length=1, max_length=80)
    category: Category
    action: Action
    match: PatternDraft | TermsDraft = Field(discriminator="type")
    context: ContextDraft | None = None


class PositiveDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    detector: str = Field(pattern=_ID)
    text: str = Field(min_length=1, max_length=2000)


class TestsDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    positives: list[PositiveDraft] = Field(default_factory=list, max_length=200)
    negatives: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(
        default_factory=list, max_length=200
    )


class PackDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    pack_id: str = Field(alias="packId", pattern=_ID)
    validity_days: int = Field(default=365, ge=1, le=730, alias="validityDays")
    detectors: list[DetectorDraft] = Field(min_length=1, max_length=200)
    tests: TestsDraft


def _normalized_terms(terms: list[str], detector_id: str) -> tuple[list[str], int]:
    normalized: list[str] = []
    widest = 0
    for term in terms:
        if has_unassigned(term):
            raise RulesPackError("unassigned_character", detector=detector_id)
        form = engine.normalize_term(term)
        if not form:
            raise RulesPackError("term_empty", detector=detector_id)
        count = form.count(" ") + 1
        if count > MAX_TERM_WORDS:
            raise RulesPackError("term_too_many_words", detector=detector_id)
        widest = max(widest, count)
        if form not in normalized:
            normalized.append(form)
    return normalized, widest


def _terms_match(
    draft: DetectorDraft, match: TermsDraft, previous: dict[str, Any] | None
) -> dict[str, Any]:
    if match.terms is None:
        kept = _previous_detector(previous, draft.id)
        if kept is None or kept["match"]["type"] != "terms":
            raise RulesPackError("terms_required", detector=draft.id)
        return dict(kept["match"])
    normalized, widest = _normalized_terms(match.terms, draft.id)
    salt = secrets.token_bytes(16)
    built = {
        "type": "terms",
        "salt": base64.b64encode(salt).decode("ascii"),
        # Triées : l'ordre de saisie ne doit rien dire des termes.
        "digests": sorted(engine.term_digest(salt, form) for form in normalized),
        "maxWords": widest,
    }
    # Chaque terme est détecté par construction : sa forme normalisée est celle que le
    # poste calcule (§4, vecteurs `terms.cases`) et son empreinte est dans la liste, avec
    # au plus `maxWords` mots. Les termes en clair s'arrêtent ici (§6).
    return built


def _previous_detector(previous: dict[str, Any] | None, detector_id: str) -> dict[str, Any] | None:
    if previous is None:
        return None
    for detector in previous.get("detectors", []):
        if isinstance(detector, dict) and detector.get("id") == detector_id:
            return detector
    return None


def _detector(draft: DetectorDraft, previous: dict[str, Any] | None) -> dict[str, Any]:
    match: dict[str, Any]
    if isinstance(draft.match, PatternDraft):
        match = {"type": "pattern", "pattern": draft.match.pattern}
        if draft.match.case_insensitive:
            match["caseInsensitive"] = True
        if draft.match.min_entropy_tenths is not None:
            match["minEntropyTenths"] = draft.match.min_entropy_tenths
    else:
        match = _terms_match(draft, draft.match, previous)
    built: dict[str, Any] = {
        "id": draft.id,
        "label": draft.label,
        "category": draft.category,
        "action": draft.action,
        "match": match,
    }
    if draft.context is not None:
        built["context"] = {
            "keywords": list(draft.context.keywords),
            "window": draft.context.window,
        }
    return built


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_payload(
    draft: PackDraft,
    *,
    tenant_id: str,
    version: int,
    previous: dict[str, Any] | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """La charge utile signable. Les termes en clair n'y entrent jamais."""
    issued = (now or datetime.now(UTC)).replace(microsecond=0)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": KIND,
        "packId": draft.pack_id,
        "tenantId": tenant_id,
        "version": version,
        "issuedAt": _iso(issued),
        "expiresAt": _iso(issued + timedelta(days=draft.validity_days)),
        "issuer": ISSUER,
        "detectors": [_detector(detector, previous) for detector in draft.detectors],
        "tests": {
            "positives": [
                {"detector": positive.detector, "text": positive.text}
                for positive in draft.tests.positives
            ],
            "negatives": list(draft.tests.negatives),
        },
    }


# ---------------------------------------------------------------------------
# Conservation en ajout seul, chaînée par tenant (§6)
# ---------------------------------------------------------------------------
PUBLISHED = "published"
REVOKED = "revoked"


def entry_digest(
    *,
    event: str,
    tenant_id: str,
    pack_id: str,
    version: int,
    digest: str,
    key_id: str | None,
    public_key: str | None,
    signature: str | None,
    expires_at: datetime | None,
    created_by: str,
    at: datetime,
) -> str:
    """Ce qui est chaîné : métadonnées, empreinte et signature du paquet, aucun contenu."""
    body = json.dumps(
        {
            "event": event,
            "tenant_id": tenant_id,
            "pack_id": pack_id,
            "version": version,
            "payload_digest": digest,
            "key_id": key_id,
            "public_key": public_key,
            "signature": signature,
            "expires_at": audit.canonical_ts(expires_at) if expires_at else None,
            "created_by": created_by,
            "at": audit.canonical_ts(at),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Published:
    tenant_id: str
    pack_id: str
    version: int
    payload: dict[str, Any]
    key_id: str
    signature: str
    payload_digest: str
    created_by: str
    created_at: datetime
    revoked: bool

    def envelope(self) -> dict[str, Any]:
        return {"payload": self.payload, "keyId": self.key_id, "signature": self.signature}


_PUBLISHED_COLUMNS = (
    "p.tenant_id::text, p.pack_id, p.version, p.payload, p.key_id, p.signature, "
    "p.payload_digest, p.created_by, p.created_at, "
    "exists (select 1 from rules_pack_events r where r.tenant_id = p.tenant_id "
    "and r.pack_id = p.pack_id and r.version = p.version and r.event = 'revoked')"
)


def _published(row: Any) -> Published:
    return Published(
        tenant_id=row[0],
        pack_id=row[1],
        version=row[2],
        payload=row[3],
        key_id=row[4],
        signature=row[5],
        payload_digest=row[6],
        created_by=row[7],
        created_at=row[8],
        revoked=bool(row[9]),
    )


def current(conn: psycopg.Connection, tenant_id: str) -> Published | None:
    """Le dernier paquet publié pour ce tenant, révoqué ou non."""
    row = conn.execute(
        f"select {_PUBLISHED_COLUMNS} from rules_pack_events p "  # noqa: S608 -- colonnes fixes
        "where p.tenant_id = %s and p.event = 'published' order by p.id desc limit 1",
        (tenant_id,),
    ).fetchone()
    return _published(row) if row else None


def history(conn: psycopg.Connection, tenant_id: str, limit: int = 20) -> list[dict[str, Any]]:
    rows = conn.execute(
        "select event, pack_id, version, payload_digest, created_at from rules_pack_events "
        "where tenant_id = %s order by id desc limit %s",
        (tenant_id, limit),
    ).fetchall()
    return [
        {
            "event": row[0],
            "packId": row[1],
            "version": row[2],
            "payloadDigest": row[3],
            "at": row[4],
        }
        for row in rows
    ]


def for_device(conn: psycopg.Connection, tenant_id: str) -> dict[str, Any] | None:
    """§7 : l'enveloppe à distribuer, ou ``None``. Jamais une version antérieure."""
    latest = current(conn, tenant_id)
    if latest is None or latest.revoked:
        return None
    return latest.envelope()


def _append(
    conn: psycopg.Connection,
    *,
    event: str,
    tenant_id: str,
    pack_id: str,
    version: int,
    digest: str,
    created_by: str,
    published: tuple[dict[str, Any], str, str, str, datetime] | None,
) -> None:
    at = datetime.now(UTC)
    key_id = published[1] if published else None
    link = entry_digest(
        event=event,
        tenant_id=tenant_id,
        pack_id=pack_id,
        version=version,
        digest=digest,
        key_id=key_id,
        public_key=published[2] if published else None,
        signature=published[3] if published else None,
        expires_at=published[4] if published else None,
        created_by=created_by[: audit.MAX_FIELD],
        at=at,
    )
    prev_row = conn.execute(
        "select entry_hash from rules_pack_events where tenant_id = %s order by id desc limit 1",
        (tenant_id,),
    ).fetchone()
    prev_hash = prev_row[0] if prev_row else audit.GENESIS
    conn.execute(
        "insert into rules_pack_events (tenant_id, event, pack_id, version, payload, key_id, "
        "public_key, signature, payload_digest, expires_at, created_by, created_at, "
        "entry_digest, prev_hash, entry_hash) "
        "values (%s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            tenant_id,
            event,
            pack_id,
            version,
            json.dumps(published[0], ensure_ascii=False) if published else None,
            key_id,
            published[2] if published else None,
            published[3] if published else None,
            digest,
            published[4] if published else None,
            created_by[: audit.MAX_FIELD],
            at,
            link,
            prev_hash,
            audit.compute_entry_hash(prev_hash, link),
        ),
    )


def _lock(conn: psycopg.Connection, tenant_id: str) -> None:
    conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"rules_pack:{tenant_id}",))


def publish(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    payload: dict[str, Any],
    expected_version: int,
    signing: Ed25519Signer,
    created_by: str,
    expected_revoked: bool = False,
) -> dict[str, Any]:
    """Signer et conserver la version suivante ; la charge doit avoir été validée.

    ``expected_version`` est la dernière version que l'opérateur a vue (0 s'il n'y en a
    pas) : deux publications croisées ne s'écrasent pas en silence. La version signée est
    ``expected_version + 1``, strictement croissante par ``(tenant, packId)``.
    """
    with conn.transaction():
        _lock(conn, tenant_id)
        latest = current(conn, tenant_id)
        seen = latest.version if latest else 0
        # Un retrait survenu pendant l'épreuve change la base de la composition (des
        # empreintes reprises d'une version retirée, par exemple) : conflit, pas signature.
        if seen != expected_version or (latest is not None and latest.revoked != expected_revoked):
            raise VersionConflict("version_conflict")
        if latest is not None and latest.pack_id != payload["packId"]:
            raise RulesPackError("pack_id_mismatch")
        signed = {**payload, "version": expected_version + 1}
        sealed = envelope(signed, signing)
        digest = payload_digest(signed)
        expires = datetime.strptime(signed["expiresAt"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
        _append(
            conn,
            event=PUBLISHED,
            tenant_id=tenant_id,
            pack_id=signed["packId"],
            version=signed["version"],
            digest=digest,
            created_by=created_by,
            published=(signed, sealed["keyId"], signing.public_key, sealed["signature"], expires),
        )
    return {**sealed, "payloadDigest": digest}


def revoke(conn: psycopg.Connection, *, tenant_id: str, version: int, revoked_by: str) -> bool:
    """Retirer la dernière version de la distribution (un enregistrement de plus)."""
    with conn.transaction():
        _lock(conn, tenant_id)
        latest = current(conn, tenant_id)
        if latest is None or latest.version != version or latest.revoked:
            return False
        _append(
            conn,
            event=REVOKED,
            tenant_id=tenant_id,
            pack_id=latest.pack_id,
            version=latest.version,
            digest=latest.payload_digest,
            created_by=revoked_by,
            published=None,
        )
    return True


def _published_row_consistent(
    tenant: str,
    pack_id: str,
    version: int,
    payload: dict[str, Any],
    public_key: str,
    signature: str,
    digest: str,
) -> bool:
    """Le paquet dit ce que disent ses colonnes, et sa signature se vérifie avec sa clé."""
    if (
        payload.get("tenantId") != tenant
        or payload.get("packId") != pack_id
        or payload.get("version") != version
        or payload_digest(payload) != digest
    ):
        return False
    try:
        raw = base64.b64decode(public_key, validate=True)
        Ed25519PublicKey.from_public_bytes(raw).verify(
            base64.b64decode(signature, validate=True), canonical(payload)
        )
    except (InvalidSignature, ValueError, TypeError):
        return False
    return True


def verify_chain(conn: psycopg.Connection, tenant_id: str) -> audit.ChainResult:
    """Recalculer chaque maillon depuis ses colonnes, et chaque paquet depuis sa signature."""
    rows = conn.execute(
        "select id, event, tenant_id::text, pack_id, version, payload, key_id, public_key, "
        "signature, expires_at, payload_digest, created_by, created_at, entry_digest, "
        "prev_hash, entry_hash from rules_pack_events where tenant_id = %s order by id",
        (tenant_id,),
    ).fetchall()
    prev = audit.GENESIS
    for row in rows:
        (row_id, event, tenant, pack_id, version, payload, key_id, public_key) = row[:8]
        (signature, expires_at, digest, by, at, stored_digest, stored_prev, stored_hash) = row[8:]
        expected = entry_digest(
            event=event,
            tenant_id=tenant,
            pack_id=pack_id,
            version=version,
            digest=digest,
            key_id=key_id,
            public_key=public_key,
            signature=signature,
            expires_at=expires_at,
            created_by=by,
            at=at,
        )
        intact = (
            stored_prev == prev
            and stored_digest == expected
            and audit.compute_entry_hash(prev, expected) == stored_hash
            and (
                payload is None
                or _published_row_consistent(
                    tenant, pack_id, version, payload, public_key, signature, digest
                )
            )
        )
        if not intact:
            return audit.ChainResult(ok=False, broken_id=row_id, count=len(rows))
        prev = stored_hash
    return audit.ChainResult(ok=True, count=len(rows))


# ---------------------------------------------------------------------------
# Lecture tenant et couverture des postes
# ---------------------------------------------------------------------------
def summary(payload: dict[str, Any], *, show_patterns: bool) -> list[dict[str, Any]]:
    """Les détecteurs tels qu'un client peut les lire : jamais un terme, jamais une empreinte."""
    detectors: list[dict[str, Any]] = []
    for detector in payload.get("detectors", []):
        match = detector["match"]
        item: dict[str, Any] = {
            "id": detector["id"],
            "label": detector["label"],
            "category": detector["category"],
            "action": detector["action"],
            "type": match["type"],
            "context": detector.get("context"),
        }
        if match["type"] == "pattern":
            if show_patterns:
                item["pattern"] = match["pattern"]
            item["caseInsensitive"] = bool(match.get("caseInsensitive", False))
            item["minEntropyTenths"] = match.get("minEntropyTenths")
        else:
            item["termsCount"] = len(match["digests"])
            item["maxWords"] = match["maxWords"]
        detectors.append(item)
    return detectors


DeviceState = Literal["up_to_date", "behind", "refused"]


def device_state(
    posture: dict[str, Any] | None, applied_digest: str | None, current_digest: str
) -> DeviceState:
    """Ce que dit le poste de son réglage, rapproché de la version publiée.

    Une déclaration du poste reste une déclaration : « à jour » veut dire que le poste
    rapporte l'empreinte de la version publiée, pas que la plateforme l'a constaté.
    """
    reasons = (posture or {}).get("posture_reasons") or []
    if "rules_pack_rejected" in reasons:
        return "refused"
    if applied_digest == current_digest:
        return "up_to_date"
    return "behind"


def coverage(conn: psycopg.Connection, tenant_id: str, current_digest: str) -> dict[str, Any]:
    rows = conn.execute(
        "select d.id::text, g.name, sync.payload, posture.payload "
        "from extension_devices d join gateway_tokens g on g.id = d.gateway_token_id "
        "left join lateral (select e.payload from extension_events e where e.device_id = d.id "
        "and e.source = 'extension' and e.payload->>'rules_pack_digest' is not null "
        "order by e.id desc limit 1) sync on true "
        "left join lateral (select e.payload from extension_events e where e.device_id = d.id "
        "and e.source = 'extension' and e.payload->>'kind' = 'posture' "
        "order by e.id desc limit 1) posture on true "
        "where d.tenant_id = %s and g.revoked_at is null "
        "order by d.last_seen_at desc limit 500",
        (tenant_id,),
    ).fetchall()
    devices: list[dict[str, Any]] = []
    counts = {"up_to_date": 0, "behind": 0, "refused": 0}
    for device_id, name, sync, posture in rows:
        applied = (sync or {}).get("rules_pack_digest")
        state = device_state(posture, applied, current_digest)
        counts[state] += 1
        devices.append(
            {
                "id": device_id,
                "name": name,
                "state": state,
                "appliedVersion": (sync or {}).get("rules_pack_version"),
                "appliedDigest": applied,
                "expired": "rules_pack_expired" in ((posture or {}).get("posture_reasons") or []),
            }
        )
    return {"total": len(devices), **counts, "devices": devices}
