"""Le compartiment de limitation, et ce qui le rendait inopérant.

`§1.5` de `docs/product/FRONT-DEMONSTRATION.md` relevait que le rate limit « ne fait
pas ce qu'on croit ». Vérification faite, le constat tient mais son mécanisme était mal
énoncé : `proxy_headers` est à `True` par défaut dans uvicorn 0.49 — ce n'est pas le
drapeau qui manque, c'est `forwarded_allow_ips`, dont le défaut `127.0.0.1` ne couvre
jamais un edge.

Conséquence identique et vérifiée ici : avec `get_remote_address`, tous les appelants
derrière un edge partagent **un seul compartiment**, et n'importe lequel met les autres
en 429. L'élargissement naïf (`*`) est pire encore : le `X-Forwarded-For` de n'importe
qui est alors cru, et il suffit d'en changer à chaque requête pour n'être jamais limité.

Une limite qu'on croit avoir est plus dangereuse qu'une limite absente.
"""

from __future__ import annotations

import hashlib

import pytest
from slowapi.util import get_remote_address
from starlette.datastructures import Headers
from starlette.requests import Request

from api.ratelimit import client_key


def _requete(chemin: str = "/v1/audit/export", ip: str = "10.0.0.1", **entetes: str) -> Request:
    """Une requête ASGI minimale, avec l'adresse du pair et les en-têtes voulus."""
    brut = [(k.lower().replace("_", "-").encode(), v.encode()) for k, v in entetes.items()]
    portee = {
        "type": "http",
        "method": "GET",
        "path": chemin,
        "headers": brut,
        "client": (ip, 51234),
        "query_string": b"",
        "scheme": "http",
        "server": ("testserver", 80),
    }
    requete = Request(portee)
    assert requete.headers == Headers(raw=brut)
    return requete


def test_two_callers_behind_one_edge_do_not_share_a_bucket() -> None:
    """Le défaut d'origine, énoncé comme un test.

    Deux porteurs de jetons différents arrivent par le même edge, donc avec la **même**
    adresse. Sous l'ancienne clé ils tombaient dans le même compartiment ; l'un
    épuisait la limite de l'autre.
    """
    edge = "172.31.0.7"
    alice = _requete(ip=edge, authorization="Bearer jeton-d-alice")
    bob = _requete(ip=edge, authorization="Bearer jeton-de-bob")

    # L'ancienne clé — la démonstration du défaut, pas une régression possible.
    assert get_remote_address(alice) == get_remote_address(bob) == edge

    # La nouvelle les sépare.
    assert client_key(alice) != client_key(bob)


def test_the_same_credential_always_lands_in_the_same_bucket() -> None:
    """Sinon la limite ne limite rien : il suffirait de changer de route ou d'adresse."""
    a = _requete(chemin="/v1/audit/export", ip="10.0.0.1", authorization="Bearer meme-jeton")
    b = _requete(chemin="/v1/ai/judge", ip="203.0.113.9", authorization="Bearer meme-jeton")
    assert client_key(a) == client_key(b)


def test_a_forged_forwarded_header_cannot_win_a_fresh_bucket() -> None:
    """Le scénario que l'élargissement à `*` aurait ouvert.

    Un appelant authentifié qui change son `X-Forwarded-For` à chaque requête doit
    rester dans le même compartiment : son identité ne change pas.
    """
    jeton = "Bearer jeton-constant"
    premiere = _requete(authorization=jeton, x_forwarded_for="1.2.3.4")
    seconde = _requete(authorization=jeton, x_forwarded_for="5.6.7.8")
    assert client_key(premiere) == client_key(seconde)


def test_the_bucket_key_never_carries_the_token() -> None:
    """La clé vit en mémoire dans le limiteur ; un secret n'a rien à y faire (§4.10)."""
    secret = "jeton-tres-secret-a-ne-pas-retenir"
    cle = client_key(_requete(authorization=f"Bearer {secret}"))
    assert secret not in cle
    assert cle == f"jeton:{hashlib.sha256(secret.encode()).hexdigest()[:32]}"


def test_an_anonymous_caller_falls_back_to_the_address() -> None:
    """Les routes publiques n'ont que ça, et c'est pour elles que
    `FORWARDED_ALLOW_IPS` doit nommer l'edge — ce que `xsom doctor` contrôle."""
    assert client_key(_requete(chemin="/v1/threats", ip="198.51.100.4")) == "ip:198.51.100.4"


def test_a_malformed_authorization_header_is_not_taken_for_an_identity() -> None:
    """Un en-tête vide ou d'un autre schéma ne doit pas ouvrir un compartiment à part.

    Sinon un appelant anonyme s'en fabrique un en envoyant `Authorization: Bearer `,
    et la limite des routes publiques ne tient plus.
    """
    for entete in ("", "Bearer", "Bearer    ", "Basic dXNlcjpwYXNz", "jeton-sans-schema"):
        cle = client_key(_requete(ip="198.51.100.4", authorization=entete))
        assert cle == "ip:198.51.100.4", f"{entete!r} a été pris pour une identité"


def test_the_doctor_names_both_ways_the_public_bucket_can_be_wrong(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Non renseignée : un seul compartiment. Réglée à `*` : plus de limite du tout.

    Le contrôle doit nommer les deux, et ne pas traiter le second comme un réglage.
    """
    from cli.main import _check_forwarded_allow_ips

    monkeypatch.delenv("FORWARDED_ALLOW_IPS", raising=False)
    (absente,) = _check_forwarded_allow_ips()
    assert absente.level == "WARN" and "un seul compartiment" in absente.message

    monkeypatch.setenv("FORWARDED_ALLOW_IPS", "*")
    (large,) = _check_forwarded_allow_ips()
    assert large.level == "FAIL", "'*' est traité comme un réglage acceptable"

    monkeypatch.setenv("FORWARDED_ALLOW_IPS", "172.31.0.7")
    (nommee,) = _check_forwarded_allow_ips()
    assert nommee.level == "OK"
