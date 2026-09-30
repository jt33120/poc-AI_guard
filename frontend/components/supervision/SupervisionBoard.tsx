"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ConsoleError, ConsoleSkeleton, EmptyState } from "@/components/ConsoleUI";
import { apiGet } from "@/lib/client";
import {
  CLASS_LABEL,
  FAMILIES,
  FAMILY_LABEL,
  WINDOWS,
  families,
  formatBin,
  formatCount,
  formatDuration,
  formatMs,
  formatRate,
  formatShare,
  isSupervision,
  pointRange,
  relativeTime,
  type Lang,
  type Supervision,
  type SupervisionWindow,
} from "@/lib/supervision";

import {
  ColumnChart,
  FAMILY_VAR,
  LatencyChart,
  Legend,
  Sparkline,
  StackedRows,
  VerdictTimeline,
} from "./charts";

const REFRESH_MS = 60_000;
const WINDOW_LABEL: Record<SupervisionWindow, Record<Lang, string>> = {
  "24h": { fr: "24 h", en: "24 h" },
  "7d": { fr: "7 jours", en: "7 days" },
  "30d": { fr: "30 jours", en: "30 days" },
};

type Status = "good" | "warning" | "critical";
const STATUS_ICON: Record<Status, string> = {
  good: "✓",
  warning: "!",
  critical: "✕",
};

function Probe({
  status,
  label,
  value,
  detail,
}: {
  status: Status;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <li className="sup-probe" data-status={status}>
      <span className="sup-probe-icon" aria-hidden="true">
        {STATUS_ICON[status]}
      </span>
      <div>
        <span className="sup-probe-label">{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </li>
  );
}

function Target({
  met,
  label,
  lang,
}: {
  met: boolean | null;
  label: string;
  lang: Lang;
}) {
  if (met === null) return <small className="sup-target">{label}</small>;
  return (
    <small className="sup-target" data-met={met}>
      <span aria-hidden="true">{met ? "✓" : "!"}</span>{" "}
      {met
        ? lang === "fr"
          ? `Objectif tenu · ${label}`
          : `Target met · ${label}`
        : lang === "fr"
          ? `Hors objectif · ${label}`
          : `Off target · ${label}`}
    </small>
  );
}

export function SupervisionBoard({
  lang,
  clientId,
}: {
  lang: Lang;
  clientId: string;
}) {
  const tr = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const [window, setWindow] = useState<SupervisionWindow>("24h");
  const [data, setData] = useState<Supervision | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [table, setTable] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(() => {
    const query = new URLSearchParams({ window });
    if (clientId !== "all") query.set("client_id", clientId);
    setLoading(true);
    apiGet<unknown>(`v1/supervision?${query.toString()}`)
      .then((payload) => {
        if (!isSupervision(payload))
          throw new Error("Unexpected supervision payload");
        setData(payload);
        setError(null);
        setNow(new Date());
      })
      .catch((reason: unknown) => setError(reason))
      .finally(() => setLoading(false));
  }, [window, clientId]);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!data) {
    return error ? (
      <ConsoleError error={error} retry={load} />
    ) : (
      <ConsoleSkeleton rows={3} />
    );
  }

  const totals = families(data.buckets);
  const decided = totals.allowed + totals.notice + totals.human + totals.refused;
  const seriesFamilies = data.series.map((point) => families(point.buckets));
  const approvals = data.approvals;
  const probes = data.probes;
  const medianMet =
    approvals.median_decision_s === null
      ? null
      : approvals.median_decision_s <= approvals.targets.median_decision_s;
  const expiryMet =
    approvals.expiry_rate === null
      ? null
      : approvals.expiry_rate <= approvals.targets.expiry_rate;
  const dbStatus: Status =
    probes.database_ms < 250 ? "good" : probes.database_ms < 1000 ? "warning" : "critical";
  const oldestPending = approvals.oldest_pending_s;

  return (
    <div className="sup-root" data-refreshing={loading}>
      <div className="sup-toolbar">
        <div
          className="sup-segmented"
          role="group"
          aria-label={tr("Période", "Period")}
        >
          {WINDOWS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === window}
              onClick={() => setWindow(option)}
            >
              {WINDOW_LABEL[option][lang]}
            </button>
          ))}
        </div>
        <p className="sup-freshness">
          <span className="sup-live" aria-hidden="true" />
          {tr("Mesuré", "Measured")}{" "}
          {new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          }).format(now)}
          {" · "}
          {tr("actualisation chaque minute", "refreshed every minute")}
        </p>
      </div>
      {error != null && <ConsoleError error={error} retry={load} />}

      <div className="sup-top">
        <section className="console-panel sup-hero">
          <p className="console-kicker">
            {tr("Actions sous contrôle", "Actions under control")} ·{" "}
            {WINDOW_LABEL[window][lang]}
          </p>
          <p className="sup-hero-figure">{formatCount(data.total, lang)}</p>
          <p className="sup-hero-caption">
            {data.total === 0
              ? tr(
                  "Aucun appel d’outil sur la période.",
                  "No tool call in this period.",
                )
              : tr(
                  `${formatShare(totals.allowed + totals.notice, data.total, lang)} autorisées par la règle, ${formatShare(totals.human, data.total, lang)} tenues pour un humain, ${formatShare(totals.refused, data.total, lang)} refusées.`,
                  `${formatShare(totals.allowed + totals.notice, data.total, lang)} allowed by rule, ${formatShare(totals.human, data.total, lang)} held for a human, ${formatShare(totals.refused, data.total, lang)} refused.`,
                )}
          </p>
          {data.total > 0 && (
            <div
              className="sup-composition"
              role="img"
              aria-label={FAMILIES.map(
                (family) =>
                  `${FAMILY_LABEL[family][lang]} ${formatCount(totals[family], lang)}`,
              ).join(", ")}
            >
              {FAMILIES.filter((family) => totals[family] > 0).map((family) => (
                <span
                  key={family}
                  style={{
                    flexGrow: totals[family],
                    background: FAMILY_VAR[family],
                  }}
                />
              ))}
            </div>
          )}
          <div className="sup-tiles">
            <div className="sup-tile">
              <span>{tr("Tenues pour un humain", "Held for a human")}</span>
              <strong>{formatCount(totals.human, lang)}</strong>
              <Sparkline
                values={seriesFamilies.map((stack) => stack.human)}
                color="var(--viz-human)"
              />
            </div>
            <div className="sup-tile">
              <span>{tr("Refusées", "Refused")}</span>
              <strong>{formatCount(totals.refused, lang)}</strong>
              <Sparkline
                values={seriesFamilies.map((stack) => stack.refused)}
                color="var(--viz-refused)"
              />
            </div>
            <div className="sup-tile">
              <span>{tr("Garde · p95", "Guard · p95")}</span>
              <strong>{formatMs(data.latency.p95, lang)}</strong>
              <small>
                p50 {formatMs(data.latency.p50, lang)} ·{" "}
                {formatCount(data.latency.samples, lang)}{" "}
                {tr("mesures", "samples")}
              </small>
            </div>
            <div className="sup-tile">
              <span>{tr("Hors verdict", "No verdict")}</span>
              <strong>{formatCount(totals.none, lang)}</strong>
              <small>
                {tr(
                  "Observé, garde ou non inspecté",
                  "Observed, guard or uninspected",
                )}
              </small>
            </div>
          </div>
        </section>

        <section className="console-panel sup-probes">
          <div className="console-panel-heading">
            <div>
              <p className="console-kicker">{tr("Sondes", "Probes")}</p>
              <h2>{tr("État mesuré", "Measured state")}</h2>
            </div>
          </div>
          <ul>
            <Probe
              status={probes.chain_ok ? "good" : "critical"}
              label={tr("Chaîne d’audit", "Audit chain")}
              value={
                probes.chain_ok
                  ? tr("Intacte", "Intact")
                  : tr(
                      `Rompue à #${probes.chain_broken_id ?? "?"}`,
                      `Broken at #${probes.chain_broken_id ?? "?"}`,
                    )
              }
              detail={tr(
                `${formatCount(probes.chain_entries, lang)} entrées recalculées à l’instant`,
                `${formatCount(probes.chain_entries, lang)} entries recomputed just now`,
              )}
            />
            <Probe
              status={probes.last_checkpoint_at ? "good" : "warning"}
              label={tr("Témoin signé", "Signed witness")}
              value={
                probes.last_checkpoint_at
                  ? relativeTime(probes.last_checkpoint_at, now, lang)
                  : tr("Aucun témoin", "No witness yet")
              }
              detail={
                probes.last_checkpoint_entries === null
                  ? tr(
                      "Un témoin signé fige la chaîne hors de la base.",
                      "A signed witness pins the chain outside the database.",
                    )
                  : tr(
                      `${formatCount(probes.last_checkpoint_entries, lang)} entrées scellées`,
                      `${formatCount(probes.last_checkpoint_entries, lang)} entries sealed`,
                    )
              }
            />
            <Probe
              status={dbStatus}
              label={tr("Base de données", "Database")}
              value={formatMs(probes.database_ms, lang)}
              detail={tr("aller-retour mesuré à la lecture", "round trip at read time")}
            />
            <Probe
              status={
                approvals.pending_now === 0
                  ? "good"
                  : oldestPending !== null &&
                      oldestPending > approvals.targets.median_decision_s
                    ? "warning"
                    : "good"
              }
              label={tr("File d’approbation", "Approval queue")}
              value={
                approvals.pending_now === 0
                  ? tr("Vide", "Empty")
                  : tr(
                      `${formatCount(approvals.pending_now, lang)} en attente`,
                      `${formatCount(approvals.pending_now, lang)} waiting`,
                    )
              }
              detail={
                oldestPending === null
                  ? undefined
                  : tr(
                      `la plus ancienne attend depuis ${formatDuration(oldestPending)}`,
                      `oldest waiting for ${formatDuration(oldestPending)}`,
                    )
              }
            />
            <Probe
              status="good"
              label={tr("Dernier événement", "Last event")}
              value={relativeTime(probes.last_event_at, now, lang)}
            />
          </ul>
        </section>
      </div>

      {data.total === 0 ? (
        <EmptyState
          title={tr(
            "La salle attend son premier appel d’outil.",
            "The room is waiting for its first tool call.",
          )}
          description={tr(
            "Raccordez un agent à la passerelle ou appelez /v1/authorize : chaque décision apparaîtra ici, mesurée.",
            "Connect an agent to the gateway or call /v1/authorize: every decision will appear here, measured.",
          )}
          action={
            <Link className="btn btn-primary" href="/onboarding">
              {tr("Connecter un agent", "Connect an agent")} ↗
            </Link>
          }
        />
      ) : (
        <>
          <section className="console-panel">
            <div className="console-panel-heading">
              <div>
                <p className="console-kicker">
                  {tr("Verdicts dans le temps", "Verdicts over time")}
                </p>
                <h2>
                  {tr(
                    "Ce que la règle a tranché, point par point",
                    "What the rule decided, point by point",
                  )}
                </h2>
              </div>
              <button
                type="button"
                className="sup-link-button"
                aria-pressed={table}
                onClick={() => setTable((shown) => !shown)}
              >
                {table
                  ? tr("Masquer le tableau", "Hide table")
                  : tr("Voir le tableau", "Show table")}
              </button>
            </div>
            <div className="sup-panel-body">
              <Legend
                lang={lang}
                items={FAMILIES.map((family) => ({
                  key: family,
                  label: FAMILY_LABEL[family][lang],
                  color: FAMILY_VAR[family],
                  value: totals[family],
                }))}
              />
              <VerdictTimeline
                points={data.series}
                window={window}
                stepSeconds={data.step_seconds}
                lang={lang}
              />
              {table && (
                <div className="sup-table-wrap">
                  <table className="sup-table">
                    <thead>
                      <tr>
                        <th scope="col">{tr("Période", "Period")}</th>
                        {FAMILIES.map((family) => (
                          <th scope="col" key={family}>
                            {FAMILY_LABEL[family][lang]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.series.map((point, index) => (
                        <tr key={point.at}>
                          <th scope="row">
                            {pointRange(point.at, data.step_seconds, window, lang)}
                          </th>
                          {FAMILIES.map((family) => (
                            <td key={family}>
                              {formatCount(seriesFamilies[index][family], lang)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <div className="sup-grid">
            <section className="console-panel">
              <div className="console-panel-heading">
                <div>
                  <p className="console-kicker">
                    {tr("Latence de la garde", "Guard latency")}
                  </p>
                  <h2>{tr("Le temps pris pour trancher", "Time taken to decide")}</h2>
                </div>
              </div>
              <div className="sup-panel-body">
                {data.latency.samples === 0 ? (
                  <p className="console-note">
                    {tr(
                      "Aucune décision mesurée sur la période : la latence apparaît dès qu’un appel passe par la garde.",
                      "No measured decision in this period: latency appears as soon as a call goes through the guard.",
                    )}
                  </p>
                ) : (
                  <>
                    <Legend
                      lang={lang}
                      items={[
                        {
                          key: "p50",
                          label: tr("médiane (p50)", "median (p50)"),
                          color: "var(--viz-p50)",
                        },
                        {
                          key: "p95",
                          label: tr("95e centile (p95)", "95th percentile (p95)"),
                          color: "var(--viz-p95)",
                        },
                      ]}
                    />
                    <LatencyChart
                      points={data.latency.series}
                      window={window}
                      stepSeconds={data.step_seconds}
                      lang={lang}
                    />
                    <p className="sup-foot">
                      {tr(
                        `Sur la période : p50 ${formatMs(data.latency.p50, lang)} · p95 ${formatMs(data.latency.p95, lang)} · p99 ${formatMs(data.latency.p99, lang)}, temps passé dans la garde seule, outil exclu.`,
                        `Over the period: p50 ${formatMs(data.latency.p50, lang)} · p95 ${formatMs(data.latency.p95, lang)} · p99 ${formatMs(data.latency.p99, lang)}, time spent in the guard alone, tool excluded.`,
                      )}
                    </p>
                  </>
                )}
              </div>
            </section>

            <section className="console-panel">
              <div className="console-panel-heading">
                <div>
                  <p className="console-kicker">
                    {tr("Décision humaine", "Human decision")}
                  </p>
                  <h2>
                    {tr("Une supervision effective", "Oversight that works")}
                  </h2>
                </div>
                <Link className="console-inline-link" href="/approvals">
                  {tr("File", "Queue")} ↗
                </Link>
              </div>
              <div className="sup-panel-body">
                <div className="sup-tiles sup-tiles-3">
                  <div className="sup-tile">
                    <span>{tr("Délai médian", "Median delay")}</span>
                    <strong>{formatDuration(approvals.median_decision_s)}</strong>
                    <Target
                      met={medianMet}
                      label={`< ${formatDuration(approvals.targets.median_decision_s)}`}
                      lang={lang}
                    />
                  </div>
                  <div className="sup-tile">
                    <span>{tr("Expirées", "Expired")}</span>
                    <strong>{formatRate(approvals.expiry_rate, lang)}</strong>
                    <Target
                      met={expiryMet}
                      label={`< ${formatRate(approvals.targets.expiry_rate, lang)}`}
                      lang={lang}
                    />
                  </div>
                  <div className="sup-tile">
                    <span>
                      {tr("Tampons", "Rubber stamps")} (&lt;{" "}
                      {approvals.targets.rubber_stamp_s} s)
                    </span>
                    <strong>{formatCount(approvals.rubber_stamps, lang)}</strong>
                    <Target
                      met={approvals.approved ? approvals.rubber_stamps === 0 : null}
                      label={tr("approuvées sans lecture possible", "approved too fast to read")}
                      lang={lang}
                    />
                  </div>
                </div>
                {approvals.created === 0 ? (
                  <p className="console-note">
                    {tr(
                      "Aucune approbation demandée sur la période.",
                      "No approval requested in this period.",
                    )}
                  </p>
                ) : (
                  <>
                    <ColumnChart
                      lang={lang}
                      ariaLabel={tr(
                        "Répartition des délais de décision humaine",
                        "Distribution of human decision delays",
                      )}
                      columns={approvals.histogram.map((bin) => ({
                        label: formatBin(bin.low_s, bin.high_s),
                        value: bin.count,
                        accent: bin.high_s !== null && bin.high_s <= approvals.targets.rubber_stamp_s
                          ? "warning"
                          : undefined,
                      }))}
                    />
                    <p className="sup-foot">
                      {tr(
                        `${formatCount(approvals.created, lang)} demandées · ${formatCount(approvals.approved, lang)} approuvées · ${formatCount(approvals.denied, lang)} refusées · ${formatCount(approvals.expired, lang)} expirées · ${formatCount(approvals.pending, lang)} en attente. p90 ${formatDuration(approvals.p90_decision_s)}.`,
                        `${formatCount(approvals.created, lang)} requested · ${formatCount(approvals.approved, lang)} approved · ${formatCount(approvals.denied, lang)} denied · ${formatCount(approvals.expired, lang)} expired · ${formatCount(approvals.pending, lang)} waiting. p90 ${formatDuration(approvals.p90_decision_s)}.`,
                      )}
                    </p>
                  </>
                )}
              </div>
            </section>
          </div>

          <div className="sup-grid">
            <section className="console-panel">
              <div className="console-panel-heading">
                <div>
                  <p className="console-kicker">
                    {tr("Par classe d’action", "By action class")}
                  </p>
                  <h2>{tr("Où la garde intervient", "Where the guard steps in")}</h2>
                </div>
              </div>
              <div className="sup-panel-body">
                <StackedRows
                  lang={lang}
                  bars={data.classes.map((entry) => {
                    const split = families(entry.buckets);
                    return {
                      key: entry.action_class,
                      label:
                        CLASS_LABEL[entry.action_class]?.[lang] ?? entry.action_class,
                      total: entry.total,
                      segments: FAMILIES.map((family) => ({
                        family,
                        value: split[family],
                      })),
                    };
                  })}
                />
              </div>
            </section>

            <section className="console-panel">
              <div className="console-panel-heading">
                <div>
                  <p className="console-kicker">
                    {tr("Outils les plus retenus", "Most held tools")}
                  </p>
                  <h2>{tr("Humain et refus, par outil", "Human and refusals, by tool")}</h2>
                </div>
                <Link className="console-inline-link" href="/inspector">
                  {tr("Inspecteur", "Inspector")} ↗
                </Link>
              </div>
              <div className="sup-panel-body">
                {data.tools.every((tool) => tool.held + tool.refused === 0) ? (
                  <p className="console-note">
                    {tr(
                      "Aucun outil retenu ni refusé sur la période.",
                      "No tool held or refused in this period.",
                    )}
                  </p>
                ) : (
                  <StackedRows
                    lang={lang}
                    mono
                    labelWidth={148}
                    bars={data.tools
                      .filter((tool) => tool.held + tool.refused > 0)
                      .map((tool) => ({
                        key: tool.tool,
                        label: tool.tool,
                        total: tool.held + tool.refused,
                        suffix: tr(
                          `/ ${formatCount(tool.total, lang)}`,
                          `/ ${formatCount(tool.total, lang)}`,
                        ),
                        segments: [
                          { family: "human" as const, value: tool.held },
                          { family: "refused" as const, value: tool.refused },
                        ],
                      }))}
                  />
                )}
              </div>
            </section>
          </div>

          {data.agents.length > 0 && (
            <section className="console-panel">
              <div className="console-panel-heading">
                <div>
                  <p className="console-kicker">{tr("Agents", "Agents")}</p>
                  <h2>{tr("Les plus actifs", "Most active")}</h2>
                </div>
              </div>
              <table className="sup-table sup-agents">
                <thead>
                  <tr>
                    <th scope="col">{tr("Agent", "Agent")}</th>
                    <th scope="col">{tr("Actions", "Actions")}</th>
                    <th scope="col">{tr("Tenues", "Held")}</th>
                    <th scope="col">{tr("Refusées", "Refused")}</th>
                    <th scope="col">{tr("Dernière activité", "Last active")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((agent) => (
                    <tr key={agent.id}>
                      <th scope="row">{agent.name ?? agent.id.slice(0, 8)}</th>
                      <td>{formatCount(agent.total, lang)}</td>
                      <td>{formatCount(agent.held, lang)}</td>
                      <td>{formatCount(agent.refused, lang)}</td>
                      <td>{relativeTime(agent.last_active, now, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {decided < data.total && (
            <p className="console-note sup-note">
              {tr(
                `${formatCount(data.total - decided, lang)} événements ne portent pas de verdict sur une action : fenêtres d’observation, événements de garde ou trafic relayé sans inspection. Ils restent comptés, et déclarés comme tels.`,
                `${formatCount(data.total - decided, lang)} events carry no verdict on an action: observation windows, guard events or traffic relayed uninspected. They stay counted, and declared as such.`,
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
