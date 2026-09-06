"""`FR-196` — résoudre un rôle depuis les revendications d'un émetteur OIDC client.

Un RSSI n'approuve pas un outil qui détient l'autorité d'approbation sur des actions
de production **et** gère son propre annuaire par invitations e-mail. C'est le constat
`EXH-8`, et c'est pourquoi la fédération n'est pas un confort : sans elle, ajouter un
membre revient à créer une identité fantôme hors de l'IdP du client.

Ce module est la moitié *pure* de la fédération : à partir des revendications déjà
vérifiées par :mod:`api.security`, il rend un rôle et un tenant, ou rien. Il ne lit
aucun réglage global, n'ouvre aucune connexion et ne journalise rien — l'écriture de
l'attribution vit dans :mod:`core.control_plane`, et la vérification de signature
reste dans :mod:`api.security`. Trois responsabilités, trois modules.

**Fail-closed, et dans un seul sens.** Un groupe que la table ne connaît pas ne rend
pas de rôle ; l'appelant tombe alors en 403 par `require_role`. Se tromper vers « pas
de rôle » ferme une porte à quelqu'un qui aurait pu entrer ; se tromper vers un rôle
ouvrirait l'approbation d'actions irréversibles à un groupe que personne n'a désigné.
Un seul de ces deux échecs se rattrape par un ticket.

**Le vocabulaire est fermé des deux côtés.** Le nom du groupe vient du client et est
donc libre ; le rôle qu'il vise est un :class:`~core.schemas.Role`, et une valeur
inconnue arrête le démarrage plutôt que de laisser une correspondance décorative dans
la configuration. Même raisonnement que le vocabulaire de substituts de `FR-178` : un
champ libre laisserait écrire « admin-ish » et ne s'en apercevoir qu'en incident.

**Précédence.** ``app_metadata.role`` gagne quand il est présent — c'est la forme
GoTrue, déjà servie, et la fédération ne doit pas changer le comportement d'un
déploiement Supabase existant. La correspondance de groupes n'est consultée qu'à
défaut.
"""

from __future__ import annotations

from typing import Any

from core.schemas import Role

#: Profondeur maximale d'un chemin de revendication (``a.b.c``). Bornée pour la même
#: raison que les longueurs Pydantic le sont (`CLAUDE.md` §4.9) : un chemin arbitraire
#: venant de la configuration ne doit pas pouvoir parcourir une structure sans fin.
MAX_PATH_DEPTH = 4

_ROLE_VALUES = {r.value for r in Role}


class RoleMapError(ValueError):
    """Correspondance groupe→rôle invalide. Levée au démarrage, jamais en requête."""


def parse_group_roles(raw: str | None) -> dict[str, Role]:
    """Lire ``groupe:role,groupe:role`` en table de correspondance.

    Rendue au démarrage pour que l'erreur soit un refus de démarrer et non un 500 au
    premier login. Un rôle inconnu arrête tout : publier une correspondance que le
    produit n'applique pas serait exactement la classe de mensonge que `FR-195` vient
    de retirer de la sonde de readiness.
    """
    if not raw or not raw.strip():
        return {}
    mapping: dict[str, Role] = {}
    for paire in raw.split(","):
        if not paire.strip():
            continue
        groupe, separateur, role_brut = paire.partition(":")
        groupe, role_brut = groupe.strip(), role_brut.strip()
        if not separateur or not groupe or not role_brut:
            raise RoleMapError(f"correspondance groupe→rôle malformée : {paire.strip()!r}")
        if role_brut not in _ROLE_VALUES:
            raise RoleMapError(
                f"rôle inconnu {role_brut!r} pour le groupe {groupe!r} ; "
                f"attendus : {', '.join(sorted(_ROLE_VALUES))}"
            )
        mapping[groupe] = Role(role_brut)
    return mapping


def claim_at(claims: dict[str, Any], path: str) -> Any:
    """Lire une revendication par chemin pointé (``app_metadata.tenant_id``).

    Rend ``None`` dès que le chemin ne mène nulle part — un segment absent, une
    traversée à travers autre chose qu'un objet, ou un chemin plus profond que
    :data:`MAX_PATH_DEPTH`. Aucune exception : un jeton mal formé est un refus
    d'authentification, pas une erreur serveur (`CLAUDE.md` §4.8).
    """
    segments = [s for s in path.split(".") if s]
    if not segments or len(segments) > MAX_PATH_DEPTH:
        return None
    courant: Any = claims
    for segment in segments:
        if not isinstance(courant, dict):
            return None
        courant = courant.get(segment)
    return courant


def groups_in(claims: dict[str, Any], path: str) -> list[str]:
    """Les groupes portés par le jeton, normalisés en liste de chaînes.

    Les IdP ne s'accordent pas sur la forme : Keycloak et Entra rendent un tableau,
    d'autres une chaîne unique. Les deux sont acceptées ; tout le reste rend une liste
    vide, ce qui vaut « aucun groupe » et donc aucun rôle.
    """
    valeur = claim_at(claims, path)
    if isinstance(valeur, str):
        return [valeur]
    if isinstance(valeur, list):
        return [v for v in valeur if isinstance(v, str)]
    return []


def role_for_groups(groups: list[str], mapping: dict[str, Role]) -> Role | None:
    """Le rôle attribué à ces groupes, ou ``None``.

    Un porteur de plusieurs groupes reconnus reçoit le **moins privilégié** des rôles
    correspondants. C'est le sens fail-closed : appartenir à un groupe de plus ne doit
    jamais élever, sinon l'ajout d'un groupe anodin dans l'IdP du client devient une
    escalade de privilège que personne ne relit.
    """
    connus = [mapping[g] for g in groups if g in mapping]
    if not connus:
        return None
    return min(connus, key=_ROLE_ORDER.__getitem__)


#: Du moins au plus privilégié. Sert au choix fail-closed de :func:`role_for_groups`.
_ROLE_ORDER: dict[Role, int] = {
    Role.viewer: 0,
    Role.operator: 1,
    Role.admin: 2,
}
