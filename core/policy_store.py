"""Persistence for per-tenant policy documents (SPEC §4/§8, M3).

A tenant with no policy yet gets a safe default: no tools declared, so every
tool is unknown and therefore denied (fail-closed, CLAUDE.md §4.4).

**Le document analysé est mémoïsé.** `EXH-9` prévient qu'une passerelle en ligne
sans chiffre de surcoût publié sera rejetée sur cette seule base ; en allant chercher
ce chiffre, le premier constat n'a pas été une latence à publier mais un défaut à
corriger. `api/authorize.py` et `api/llm_proxy.py` appelaient :func:`load_policy` **à
chaque requête**, donc `yaml.safe_load` plus une validation Pydantic complète sur le
chemin chaud. Mesuré sur la policy par défaut : ~296 µs (p50) contre **1,3 µs** pour la
décision que ce parse sert — le parse coûtait environ **230 fois** la décision, et
davantage à mesure que la policy du client grossit.

La passerelle MCP ne payait pas cela (`gateway/server.py` charge une fois par session,
au démarrage) : les deux chemins divergeaient donc en coût sans que rien ne le dise,
ce qui est la famille de défauts qu'`AD-28` traque sur la couverture.

Le cache est clé sur le **texte** du document, pas sur le tenant : deux tenants qui
appliquent la même policy partagent l'objet, et un document modifié est un texte
différent, donc une clé différente. L'invalidation n'a rien à orchestrer — il n'y a pas
de moment où le cache peut être en retard sur la base. C'est ce qui permet de ne pas
écrire de code d'invalidation, qui est le code qu'on écrit mal.

Partager un objet entre requêtes n'est sûr que s'il est immuable : les modèles de
:mod:`core.policy` sont `frozen=True`, et une tentative de mutation lève plutôt que de
faire fuir la policy d'un tenant vers le suivant.
"""

from __future__ import annotations

from functools import lru_cache

import psycopg

from core.policy import Policy, parse_policy

#: Nombre de documents distincts gardés. Borné pour la même raison que tout le reste
#: l'est (`CLAUDE.md` §4.9) : un cache sans plafond est une fuite de mémoire qu'un
#: client multi-tenant finit par trouver.
PARSE_CACHE_SIZE = 128

DEFAULT_POLICY_YAML = """\
# Default policy — fail-closed until configured.
tools: []
defaults:
  unknown_tool: deny
  hitl_timeout_seconds: 3600
  on_approval_service_down: deny
"""


def load_yaml(conn: psycopg.Connection, tenant_id: str) -> tuple[str, int]:
    """Return (yaml, version) for a tenant, or the default policy at version 0."""
    row = conn.execute(
        "select yaml, version from tool_policies where tenant_id = %s",
        (tenant_id,),
    ).fetchone()
    if row is None:
        return DEFAULT_POLICY_YAML, 0
    return row[0], row[1]


@lru_cache(maxsize=PARSE_CACHE_SIZE)
def _parse_cached(yaml_text: str) -> Policy:
    """Le document analysé, mémoïsé sur son texte.

    Le parse est déterministe et le résultat est immuable : mémoïser n'est donc pas
    un pari, c'est l'observation qu'on refaisait le même travail. Les erreurs ne sont
    pas mises en cache — `parse_policy` lève, et `lru_cache` ne retient pas les levées.
    """
    return parse_policy(yaml_text)


def load_policy(conn: psycopg.Connection, tenant_id: str) -> Policy:
    """Load and parse the effective policy for a tenant.

    La lecture en base reste faite à chaque appel — elle est ce qui rend la policy
    courante, et l'économiser demanderait une invalidation. Seul le **parse** est
    mémoïsé, et c'est lui qui coûtait (voir l'en-tête du module).
    """
    yaml_text, _ = load_yaml(conn, tenant_id)
    return _parse_cached(yaml_text)


def save_yaml(conn: psycopg.Connection, tenant_id: str, yaml_text: str) -> int:
    """Upsert a tenant's policy, bumping the version. Returns the new version."""
    row = conn.execute(
        "insert into tool_policies (tenant_id, yaml, version) values (%s, %s, 1) "
        "on conflict (tenant_id) do update "
        "set yaml = excluded.yaml, version = tool_policies.version + 1, updated_at = now() "
        "returning version",
        (tenant_id, yaml_text),
    ).fetchone()
    conn.commit()
    if row is None:  # pragma: no cover - upsert always returns a row
        raise RuntimeError("policy upsert did not return a version")
    return int(row[0])
