"""La salle de supervision : ce que la garde a décidé, mesuré sur toute la fenêtre.

La vue d'ensemble comptait les verdicts dans le navigateur, sur les 500 dernières
lignes du journal. Pour un tenant actif, « les refus de la semaine » y voulait donc
dire « les refus du dernier lot chargé ». Tout se compte ici en SQL, sur la période
entière, avec les mêmes bornes que le journal (`core/audit.py::_filtres`) et la même
partition des décisions que le dossier de conformité (`core/export.py::summarise`).

**Mesures, pas estimations.** Chaque chiffre vient d'une ligne écrite par la garde :
`decision_ms` est le temps passé dans la garde elle-même, l'écart entre création et
décision d'une approbation vient de la table `approvals`, et l'intégrité de la chaîne
est recalculée (`verify_chain`), pas lue dans un drapeau. La seule sonde active est un
aller-retour `select 1` vers la base, chronométré au moment de la lecture.

**Les objectifs sont ceux du PRD** (SM-5, CM-2) : médiane de décision humaine sous
cinq minutes, moins de 10 % d'approbations expirées, et le « tampon » — une
approbation accordée en moins de cinq secondes — compté plutôt que caché.
"""

from __future__ import annotations

import time
from collections import Counter
from datetime import UTC, datetime, timedelta
from statistics import median, quantiles
from typing import Any, Literal

import psycopg
from pydantic import BaseModel

from core import audit, export

Window = Literal["24h", "7d", "30d"]

#: La fenêtre, et le pas d'un point de série. Ni trop fin (du bruit), ni trop gros
#: (une semaine en sept points ne montre pas le jour où tout a basculé).
_WINDOWS: dict[str, tuple[timedelta, timedelta]] = {
    "24h": (timedelta(hours=24), timedelta(hours=1)),
    "7d": (timedelta(days=7), timedelta(hours=6)),
    "30d": (timedelta(days=30), timedelta(days=1)),
}

#: PRD SM-5 : médiane de la création à la décision humaine.
TARGET_MEDIAN_DECISION_S = 300.0
#: PRD SM-5 : part des approbations laissées expirer.
TARGET_EXPIRY_RATE = 0.10
#: PRD CM-2 : sous ce délai, une approbation n'a pas pu être lue.
RUBBER_STAMP_S = 5.0

#: Les classes de délai de décision humaine, bornes en secondes (la dernière est ouverte).
_DECISION_BINS: tuple[tuple[float, float | None], ...] = (
    (0.0, 5.0),
    (5.0, 30.0),
    (30.0, 120.0),
    (120.0, 600.0),
    (600.0, 3600.0),
    (3600.0, None),
)

_TOP_TOOLS = 6
_TOP_AGENTS = 5
#: Au-delà, les délais de décision sont échantillonnés sur les plus récents.
_MAX_DECISION_SAMPLES = 10_000

_HELD = ("held_for_human", "human_approved")
_REFUSED = "refused"


class SeriesPoint(BaseModel):
    at: datetime
    buckets: dict[str, int]


class LatencyPoint(BaseModel):
    at: datetime
    samples: int
    p50: float | None
    p95: float | None


class Latency(BaseModel):
    samples: int
    p50: float | None
    p95: float | None
    p99: float | None
    series: list[LatencyPoint]


class ClassBreakdown(BaseModel):
    action_class: str
    total: int
    buckets: dict[str, int]


class ToolLine(BaseModel):
    tool: str
    total: int
    held: int
    refused: int


class AgentLine(BaseModel):
    id: str
    name: str | None
    total: int
    held: int
    refused: int
    last_active: datetime | None


class DecisionBin(BaseModel):
    low_s: float
    high_s: float | None
    count: int


class ApprovalTargets(BaseModel):
    median_decision_s: float = TARGET_MEDIAN_DECISION_S
    expiry_rate: float = TARGET_EXPIRY_RATE
    rubber_stamp_s: float = RUBBER_STAMP_S


class Approvals(BaseModel):
    created: int
    approved: int
    denied: int
    expired: int
    pending: int
    median_decision_s: float | None
    p90_decision_s: float | None
    rubber_stamps: int
    expiry_rate: float | None
    histogram: list[DecisionBin]
    pending_now: int
    oldest_pending_s: float | None
    targets: ApprovalTargets = ApprovalTargets()


class Probes(BaseModel):
    database_ms: float
    chain_ok: bool
    chain_entries: int
    chain_broken_id: int | None
    last_checkpoint_at: datetime | None
    last_checkpoint_entries: int | None
    last_event_at: datetime | None


class Supervision(BaseModel):
    window: Window
    step_seconds: int
    start: datetime
    end: datetime
    generated_at: datetime
    total: int
    buckets: dict[str, int]
    series: list[SeriesPoint]
    latency: Latency
    classes: list[ClassBreakdown]
    tools: list[ToolLine]
    agents: list[AgentLine]
    approvals: Approvals
    probes: Probes


def bounds(window: Window, now: datetime) -> tuple[datetime, datetime, timedelta]:
    """[start, end) aligned on the step, so every point covers a whole step."""
    span, step = _WINDOWS[window]
    epoch = datetime(2000, 1, 1, tzinfo=UTC)
    steps_since = (now - epoch) // step
    end = epoch + (steps_since + 1) * step
    return end - span, end, step


def _scope(
    tenant_id: str, start: datetime, end: datetime, agent: str | None, client_id: str | None
) -> tuple[str, list[Any]]:
    where, params = audit._filtres(agent=agent, client_id=client_id)
    clauses = "tenant_id = %s and ts >= %s and ts < %s"
    extra = where.removeprefix(" where ")
    return (
        f" where {clauses}" + (f" and {extra}" if extra else ""),
        [tenant_id, start, end, *params],
    )


def _series(
    conn: psycopg.Connection,
    where: str,
    params: list[Any],
    start: datetime,
    end: datetime,
    step: timedelta,
) -> list[SeriesPoint]:
    rows = conn.execute(
        "select date_bin(%s, ts, %s) as at, decision, count(*) from audit_log"
        + where
        + " group by 1, 2",
        (step, start, *params),
    ).fetchall()
    per_point: dict[datetime, Counter[str]] = {}
    for at, decision, count in rows:
        per_point.setdefault(at, Counter())[decision or "unknown"] += int(count)
    points: list[SeriesPoint] = []
    at = start
    while at < end:
        points.append(
            SeriesPoint(at=at, buckets=export.summarise(dict(per_point.get(at, Counter()))))
        )
        at += step
    return points


def _latency(
    conn: psycopg.Connection,
    where: str,
    params: list[Any],
    start: datetime,
    end: datetime,
    step: timedelta,
) -> Latency:
    overall = conn.execute(
        "select count(decision_ms),"
        " percentile_cont(0.5) within group (order by decision_ms),"
        " percentile_cont(0.95) within group (order by decision_ms),"
        " percentile_cont(0.99) within group (order by decision_ms)"
        " from audit_log" + where + " and decision_ms is not null",
        tuple(params),
    ).fetchone()
    rows = conn.execute(
        "select date_bin(%s, ts, %s), count(decision_ms),"
        " percentile_cont(0.5) within group (order by decision_ms),"
        " percentile_cont(0.95) within group (order by decision_ms)"
        " from audit_log" + where + " and decision_ms is not null group by 1",
        (step, start, *params),
    ).fetchall()
    by_point = {row[0]: row for row in rows}
    series: list[LatencyPoint] = []
    at = start
    while at < end:
        row = by_point.get(at)
        series.append(
            LatencyPoint(
                at=at,
                samples=int(row[1]) if row else 0,
                p50=_round(row[2]) if row else None,
                p95=_round(row[3]) if row else None,
            )
        )
        at += step
    samples = int(overall[0]) if overall else 0
    return Latency(
        samples=samples,
        p50=_round(overall[1]) if overall and samples else None,
        p95=_round(overall[2]) if overall and samples else None,
        p99=_round(overall[3]) if overall and samples else None,
        series=series,
    )


def _round(value: Any) -> float | None:
    return None if value is None else round(float(value), 2)


def _classes(conn: psycopg.Connection, where: str, params: list[Any]) -> list[ClassBreakdown]:
    rows = conn.execute(
        "select coalesce(action_class, 'unclassified'), decision, count(*) from audit_log"
        + where
        + " group by 1, 2",
        tuple(params),
    ).fetchall()
    per_class: dict[str, Counter[str]] = {}
    for action_class, decision, count in rows:
        per_class.setdefault(action_class, Counter())[decision or "unknown"] += int(count)
    order = ["read", "write", "external_send", "irreversible"]
    names = sorted(per_class, key=lambda c: (order.index(c) if c in order else len(order), c))
    return [
        ClassBreakdown(
            action_class=name,
            total=sum(per_class[name].values()),
            buckets=export.summarise(dict(per_class[name])),
        )
        for name in names
    ]


def _held_refused(buckets: dict[str, int]) -> tuple[int, int]:
    return sum(buckets[b] for b in _HELD), buckets[_REFUSED]


def _tools(conn: psycopg.Connection, where: str, params: list[Any]) -> list[ToolLine]:
    rows = conn.execute(
        "select tool_name, decision, count(*) from audit_log"
        + where
        + " and tool_name is not null group by 1, 2",
        tuple(params),
    ).fetchall()
    per_tool: dict[str, Counter[str]] = {}
    for tool, decision, count in rows:
        per_tool.setdefault(tool, Counter())[decision or "unknown"] += int(count)
    lines = []
    for tool, counts in per_tool.items():
        held, refused = _held_refused(export.summarise(dict(counts)))
        lines.append(ToolLine(tool=tool, total=sum(counts.values()), held=held, refused=refused))
    lines.sort(key=lambda line: (-(line.held + line.refused), -line.total, line.tool))
    return lines[:_TOP_TOOLS]


def _agents(conn: psycopg.Connection, where: str, params: list[Any]) -> list[AgentLine]:
    rows = conn.execute(
        "select e.agent, t.name, e.decision, e.n, e.last from ("
        " select gateway_token_id as agent, decision, count(*) as n, max(ts) as last"
        " from audit_log" + where + " and gateway_token_id is not null group by 1, 2"
        ") e left join gateway_tokens t on t.id = e.agent",
        tuple(params),
    ).fetchall()
    per_agent: dict[str, tuple[str | None, Counter[str], datetime | None]] = {}
    for agent, name, decision, count, last in rows:
        agent_id = str(agent)
        _, counts, seen = per_agent.get(agent_id, (name, Counter(), None))
        counts[decision or "unknown"] += int(count)
        latest = last if seen is None or (last is not None and last > seen) else seen
        per_agent[agent_id] = (name, counts, latest)
    lines = []
    for agent_id, (name, counts, last) in per_agent.items():
        held, refused = _held_refused(export.summarise(dict(counts)))
        lines.append(
            AgentLine(
                id=agent_id,
                name=name,
                total=sum(counts.values()),
                held=held,
                refused=refused,
                last_active=last,
            )
        )
    lines.sort(key=lambda line: (-line.total, line.id))
    return lines[:_TOP_AGENTS]


def _approvals(
    conn: psycopg.Connection, tenant_id: str, start: datetime, now: datetime
) -> Approvals:
    statuses = {
        row[0]: int(row[1])
        for row in conn.execute(
            "select case when status = 'pending' and expires_at <= %s then 'expired'"
            " else status end, count(*) from approvals"
            " where tenant_id = %s and created_at >= %s group by 1",
            (now, tenant_id, start),
        ).fetchall()
    }
    durations = [
        float(row[0])
        for row in conn.execute(
            "select extract(epoch from decided_at - created_at) from approvals"
            " where tenant_id = %s and created_at >= %s and decided_at is not null"
            " and status in ('approved', 'denied') order by created_at desc limit %s",
            (tenant_id, start, _MAX_DECISION_SAMPLES),
        ).fetchall()
    ]
    approved_fast = conn.execute(
        "select count(*) from approvals where tenant_id = %s and created_at >= %s"
        " and status = 'approved' and decided_at is not null"
        " and decided_at - created_at < %s",
        (tenant_id, start, timedelta(seconds=RUBBER_STAMP_S)),
    ).fetchone()
    pending_row = conn.execute(
        "select count(*), min(created_at) from approvals"
        " where tenant_id = %s and status = 'pending' and expires_at > %s",
        (tenant_id, now),
    ).fetchone()
    created = sum(statuses.values())
    expired = statuses.get("expired", 0)
    closed = statuses.get("approved", 0) + statuses.get("denied", 0) + expired
    histogram = [
        DecisionBin(
            low_s=low,
            high_s=high,
            count=sum(1 for d in durations if d >= low and (high is None or d < high)),
        )
        for low, high in _DECISION_BINS
    ]
    oldest = pending_row[1] if pending_row else None
    return Approvals(
        created=created,
        approved=statuses.get("approved", 0),
        denied=statuses.get("denied", 0),
        expired=expired,
        pending=statuses.get("pending", 0),
        median_decision_s=round(median(durations), 1) if durations else None,
        p90_decision_s=(
            round(quantiles(durations, n=10, method="inclusive")[-1], 1)
            if len(durations) >= 2
            else (round(durations[0], 1) if durations else None)
        ),
        rubber_stamps=int(approved_fast[0]) if approved_fast else 0,
        expiry_rate=round(expired / closed, 4) if closed else None,
        histogram=histogram,
        pending_now=int(pending_row[0]) if pending_row else 0,
        oldest_pending_s=round((now - oldest).total_seconds(), 1) if oldest else None,
    )


def _probes(conn: psycopg.Connection, tenant_id: str, where: str, params: list[Any]) -> Probes:
    started = time.perf_counter()
    conn.execute("select 1").fetchone()
    database_ms = round((time.perf_counter() - started) * 1000, 2)
    chain = audit.verify_chain(conn, tenant_id)
    checkpoint = conn.execute(
        "select at, entries from audit_checkpoints where tenant_id = %s order by id desc limit 1",
        (tenant_id,),
    ).fetchone()
    last_event = conn.execute("select max(ts) from audit_log" + where, tuple(params)).fetchone()
    return Probes(
        database_ms=database_ms,
        chain_ok=chain.ok,
        chain_entries=chain.count,
        chain_broken_id=chain.broken_id,
        last_checkpoint_at=checkpoint[0] if checkpoint else None,
        last_checkpoint_entries=int(checkpoint[1]) if checkpoint else None,
        last_event_at=last_event[0] if last_event else None,
    )


def build(
    conn: psycopg.Connection,
    *,
    tenant_id: str,
    window: Window,
    agent: str | None = None,
    client_id: str | None = None,
    now: datetime | None = None,
) -> Supervision:
    """Everything the supervision room shows, for one tenant and one window."""
    moment = now or datetime.now(UTC)
    start, end, step = bounds(window, moment)
    where, params = _scope(tenant_id, start, end, agent, client_id)
    series = _series(conn, where, params, start, end, step)
    totals: Counter[str] = Counter()
    for point in series:
        totals.update(point.buckets)
    buckets = {name: totals.get(name, 0) for name in export.BUCKETS}
    return Supervision(
        window=window,
        step_seconds=int(step.total_seconds()),
        start=start,
        end=end,
        generated_at=moment,
        total=sum(buckets.values()),
        buckets=buckets,
        series=series,
        latency=_latency(conn, where, params, start, end, step),
        classes=_classes(conn, where, params),
        tools=_tools(conn, where, params),
        agents=_agents(conn, where, params),
        approvals=_approvals(conn, tenant_id, start, moment),
        probes=_probes(conn, tenant_id, where, params),
    )
