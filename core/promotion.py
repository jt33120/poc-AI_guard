"""FR-180 — le rapport de promotion : ce que l'enforcement *aurait* fait.

C'est l'artefact de conversion du produit. Un prospect ouvre une fenêtre
d'observation, laisse tourner sa flotte, et lit ensuite une phrase qu'aucune
démonstration ne peut fabriquer : « pendant ces trois jours, N appels de vos
agents auraient été tenus pour approbation humaine et M refusés ». Ce sont ses
agents, ses outils, ses chiffres.

Deux disciplines que la spec ratifiée (`blueprint/04-ecrans/promotion.yaml`) impose
et qui décident de l'honnêteté du chiffre :

**Zéro n'est pas « aucune donnée ».** Une fenêtre ouverte pendant laquelle rien
n'a été observé doit se lire « aucune donnée », jamais « 0 tenus » — un zéro se
lirait « rien n'aurait été tenu », c'est-à-dire exactement l'inverse du message.
Le rapport porte donc `observations` à part, et le rendu s'en sert pour choisir
entre les deux.

**Les bornes voyagent avec les chiffres.** L'observation ne relâche jamais
l'irréversible ni l'envoi externe (`AD-27.2`) : ces actions ont été bloquées
pendant toute la période. Un compte présenté sans cette réserve laisserait croire
que la flotte a été libre, et surestimerait ce que l'enforcement va changer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import psycopg

from core.audit import EnforcementMode, Ingress
from core.monitor import NEVER_OBSERVED

__all__ = ["PromotionReport", "ToolLine", "build_report"]

#: `_process` records `monitor_<verdict>` for a call the policy would have stopped
#: (`AD-27.3`). The suffix is what would have happened, so it is what the report
#: counts -- from inside the hashed payload rather than from an annex column.
_WOULD_HOLD = "monitor_hold"
_WOULD_REFUSE = "monitor_deny"


@dataclass(frozen=True, slots=True)
class ToolLine:
    """One tool's share of what enforcement would have done."""

    tool: str
    held: int
    refused: int
    dominant_class: str | None


@dataclass(frozen=True, slots=True)
class PromotionReport:
    """What enforcement would have done over the observed period."""

    #: every call seen while a window was open, not only the relaxed ones
    observations: int
    held: int
    refused: int
    tools: tuple[ToolLine, ...]
    windows: int
    period_from: str | None
    period_to: str | None
    window_still_open: bool

    @property
    def has_data(self) -> bool:
        """Whether there is anything to count. `False` renders as words, not zeros."""
        return self.observations > 0

    def statement(self) -> str:
        if not self.windows:
            return "Aucune période d'observation enregistrée."
        if not self.has_data:
            return (
                "Une période d'observation est enregistrée, mais aucun appel n'y a été "
                "observé : il n'y a rien à compter. Ce n'est pas « zéro appel aurait été "
                "tenu »."
            )
        tense = "est en cours" if self.window_still_open else "est close"
        return (
            f"Si l'enforcement avait été actif, {self.held} appel(s) auraient été tenus "
            f"pour approbation humaine et {self.refused} refusés, sur "
            f"{self.observations} appel(s) observés. La période {tense}. "
            f"L'observation n'a jamais couvert "
            f"{', '.join(sorted(c.value for c in NEVER_OBSERVED))} : ces actions ont été "
            "bloquées pendant toute la période."
        )


def _period(conn: psycopg.Connection, tenant_id: str, agent: str | None) -> tuple[Any, ...]:
    clause = " and gateway_token_id = %s" if agent else ""
    params: list[Any] = [tenant_id] + ([agent] if agent else [])
    row = conn.execute(
        "select count(*), min(opened_at), max(coalesce(closed_at, expires_at)), "
        " count(*) filter (where closed_at is null and expires_at > now()) "
        f"from monitor_windows where tenant_id = %s{clause}",
        tuple(params),
    ).fetchone()
    return row if row else (0, None, None, 0)


def build_report(
    conn: psycopg.Connection, *, tenant_id: str, agent: str | None = None
) -> PromotionReport:
    """Assemble the promotion report for a tenant, optionally for one agent.

    Reads only rows the gateway itself wrote as observed (`enforcement_mode`,
    `FR-160`), so the count cannot drift from the posture the audit row records.
    Counting by window date instead would include calls made while enforcing, and
    inflate the number the whole conversation turns on.
    """
    windows, period_from, period_to, still_open = _period(conn, tenant_id, agent)

    clause = " and gateway_token_id = %s" if agent else ""
    params: list[Any] = [
        EnforcementMode.observing.value,
        Ingress.llm_proxy.value,
        tenant_id,
    ] + ([agent] if agent else [])
    rows = conn.execute(
        "select tool_name, "
        " count(*) filter (where decision = 'monitor_hold') as held, "
        " count(*) filter (where decision = 'monitor_deny') as refused, "
        " count(*) as seen, "
        " mode() within group (order by action_class) as dominant "
        "from audit_log "
        "where enforcement_mode = %s and ingress = %s and tenant_id = %s" + clause + " "
        "group by tool_name order by held desc, seen desc",
        tuple(params),
    ).fetchall()

    tools = tuple(
        ToolLine(tool=r[0] or "(inconnu)", held=int(r[1]), refused=int(r[2]), dominant_class=r[4])
        for r in rows
    )
    return PromotionReport(
        observations=sum(int(r[3]) for r in rows),
        held=sum(line.held for line in tools),
        refused=sum(line.refused for line in tools),
        tools=tools,
        windows=int(windows),
        period_from=period_from.isoformat() if period_from else None,
        period_to=period_to.isoformat() if period_to else None,
        window_still_open=bool(still_open),
    )
