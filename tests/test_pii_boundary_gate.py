"""G-22 — aucune PII ne franchit une frontière sortante par la valeur d'une clé anodine.

`core/approvals.py` masque par **nom de clé** : `password`, `secret`, `token`… Une PII
dans la valeur d'une clé que personne ne penserait à interdire — `body`, `text`,
`message` — passe entière (tronquée à 200 caractères).

Deux frontières consomment ce résultat, et **les deux promettent par écrit le
contraire** :

* `core/judge.py` : *« only redacted arguments are ever sent to the model »* — le
  modèle est un tiers, hors du périmètre ;
* `core/notify.py` : *« must never carry secrets/PII — only the redacted dry-run
  summary »* — l'e-mail sort par SMTP.

La troisième consommation, elle, doit garder le contenu : le dry-run que **l'humain
approuve**. On ne peut pas approuver ce qu'on ne voit pas. C'est cette asymétrie qui
fait que le correctif n'est pas « masquer partout » — et c'est la moitié passante que
les tests vérifient aussi.
"""

from __future__ import annotations

from email.message import EmailMessage
from typing import Any

import pytest

from core import approvals
from core.judge import Judge
from core.notify import SmtpNotifier

#: Un NIR à clé de contrôle valide et un IBAN à somme de contrôle valide. Des valeurs
#: qui passent leur validateur ne sont pas des motifs qui ressemblent — ce sont des
#: données réelles au sens des détecteurs du produit.
_NIR = "1 80 05 75 116 001 13"
_IBAN = "FR7630006000011234567890189"

#: La clé est délibérément banale : c'est tout le sujet de `G-22`.
_ARGS: dict[str, Any] = {
    "destinataire": "service-client",
    "body": f"Dossier de M. Dupont, NIR {_NIR}, virement vers {_IBAN}.",
}


def test_pii_under_an_innocuous_key_does_not_reach_the_model() -> None:
    """Le juge est un tiers hors périmètre : rien de sensible ne doit lui parvenir."""
    vu: list[str] = []

    def completer(_system: str, user: str) -> str:
        vu.append(user)
        return '{"action_class": "write"}'

    Judge(completer).classify("mail.send", _ARGS)

    assert vu, "le juge n'a pas été appelé"
    prompt = vu[0]
    assert _NIR not in prompt
    assert _IBAN not in prompt


def test_the_model_still_receives_enough_to_classify() -> None:
    """La moitié passante. Un juge à qui on ne dit rien classe mal, donc plus haut.

    Masquer le contenu ne doit pas masquer la *forme* : le nom de l'outil et les clés
    sont ce sur quoi porte la classification, et ils traversent.
    """
    vu: list[str] = []

    def completer(_system: str, user: str) -> str:
        vu.append(user)
        return '{"action_class": "write"}'

    Judge(completer).classify("mail.send", _ARGS)

    prompt = vu[0]
    assert "mail.send" in prompt
    assert "body" in prompt
    assert "destinataire" in prompt
    assert "service-client" in prompt  # une valeur anodine n'est pas masquée


def test_pii_under_an_innocuous_key_does_not_leave_by_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """La notification sort par SMTP : la promesse de son propre docstring."""
    envoyes: list[EmailMessage] = []

    class FakeSmtp:
        def __enter__(self) -> FakeSmtp:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def starttls(self) -> None:
            return None

        def login(self, *_: object) -> None:
            return None

        def send_message(self, message: EmailMessage) -> None:
            envoyes.append(message)

    monkeypatch.setattr("smtplib.SMTP", lambda *a, **k: FakeSmtp())

    summary = approvals.build_dry_run("mail.send", "irreversible", _ARGS)["summary"]
    SmtpNotifier(
        host="smtp.example.test",
        port=587,
        username=None,
        password=None,
        sender="guard@example.test",
        recipient="ops@example.test",
    ).notify_approval(approval_id="a-1", summary=summary, expires_at="2026-01-01T00:00:00Z")

    assert envoyes, "aucun message n'a été envoyé"
    corps = envoyes[0].get_content()
    assert _NIR not in corps
    assert _IBAN not in corps
    assert "a-1" in corps  # la moitié passante : la notification reste utile


def test_the_human_approver_still_sees_what_they_approve() -> None:
    """La moitié qui empêche le correctif d'être une panne.

    Le dry-run stocké est lu par un opérateur du tenant, dans le périmètre, et c'est
    la pièce sur laquelle il fonde son approbation. Masquer là rendrait le HITL
    décoratif : approuver un virement sans en voir le bénéficiaire n'est pas
    approuver.
    """
    dry_run = approvals.build_dry_run("mail.send", "irreversible", _ARGS)
    assert _NIR in dry_run["summary"]
    assert _IBAN in dry_run["summary"]


def test_a_secret_key_is_still_masked_everywhere() -> None:
    """Le masquage par nom de clé ne disparaît pas — il devient insuffisant, pas faux."""
    dry_run = approvals.build_dry_run("api.call", "write", {"api_key": "sk-live-42"})
    assert "sk-live-42" not in dry_run["summary"]


def test_a_free_text_name_is_a_declared_residual() -> None:
    """Ce que la rédaction de contenu ne fait **pas**, écrit plutôt que découvert.

    Les détecteurs reconnaissent de la PII *structurée* : identifiants à somme de
    contrôle, e-mails, secrets. Un nom en texte libre n'a pas de forme — le
    reconnaître demanderait une heuristique de langue dont le taux de faux positifs
    masquerait de la prose métier légitime, et une garde qui masque tout ne dit plus
    rien à un juge dont le travail est de classer.

    Le résidu est donc assumé et borné : ce test le fixe, pour qu'il se voie le jour
    où il change au lieu d'être supposé couvert.
    """
    vu: list[str] = []

    def completer(_system: str, user: str) -> str:
        vu.append(user)
        return '{"action_class": "write"}'

    Judge(completer).classify("mail.send", {"body": "Dossier de M. Dupont."})

    assert "Dupont" in vu[0]
