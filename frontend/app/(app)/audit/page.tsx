"use client";

import { useEffect, useState } from "react";
import {
  ClientScopeBar,
  clientSuffix,
  useClientScope,
} from "@/components/ClientScope";
import {
  ConsoleError,
  ConsoleHeader,
  ConsoleSkeleton,
  DataPair,
  EmptyState,
  localTime,
} from "@/components/ConsoleUI";
import { AuditChain, VerdictBadge } from "@/design-system/react";
import { apiGet, exportUrl } from "@/lib/client";
import { type AuditEntry, signalKinds } from "@/lib/console-types";
import { useT } from "@/lib/i18n";

export default function AuditPage() {
  const { t, lang } = useT();
  const { selected, agents } = useClientScope();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [focused, setFocused] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const tr = (fr: string, en: string) => (lang === "fr" ? fr : en);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    setEntries([]);
    setFocused(null);
    const suffix = clientSuffix(selected);
    const params = new URLSearchParams(
      suffix.startsWith("?") ? suffix.slice(1) : suffix,
    );
    if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
    if (to) params.set("to", new Date(`${to}T23:59:59.999`).toISOString());
    apiGet<AuditEntry[]>(`v1/audit?${params.toString()}`)
      .then((data) => {
        if (current) setEntries(data);
      })
      .catch((e) => {
        if (current) setError(e);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [selected, from, to, revision]);
  const filtered = entries.filter(
    (entry) =>
      (!verdict || entry.decision === verdict) &&
      `${entry.tool_name} ${entry.id} ${entry.args_hash} ${entry.error ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const event = entries.find((entry) => entry.id === focused);
  const decisions = Array.from(
    new Set(
      entries
        .map((entry) => entry.decision)
        .filter((value): value is string => !!value),
    ),
  );
  const exportHref = (format: string, render: string) =>
    `${exportUrl(format, render)}${from ? `&from=${encodeURIComponent(new Date(`${from}T00:00:00`).toISOString())}` : ""}${to ? `&to=${encodeURIComponent(new Date(`${to}T23:59:59.999`).toISOString())}` : ""}`;

  return (
    <section className="console-page">
      <ConsoleHeader
        eyebrow="04 / APPEND-ONLY"
        title={tr(
          "Chaque décision laisse trace.",
          "Every decision leaves a trace.",
        )}
        description={tr(
          "Métadonnées, horodatage, empreinte. Le contenu sensible reste hors du journal.",
          "Metadata, timestamp, fingerprint. Sensitive content stays out of the log.",
        )}
        actions={
          <>
            <a className="btn btn-primary" href={exportHref("ai_act", "pdf")}>
              {t("audit.export.aiact")} <span aria-hidden="true">↗</span>
            </a>
            <a className="btn btn-ghost" href={exportHref("rgpd", "json")}>
              {t("audit.export.gdpr")}
            </a>
          </>
        }
      />
      <ClientScopeBar />
      <p className="console-note">
        {tr(
          "Les exports couvrent le tenant et la période, indépendamment du filtre d’agent ou de verdict.",
          "Exports cover the tenant and date range, regardless of agent or verdict filters.",
        )}
      </p>
      <div className="console-filter-bar">
        <label>
          <span>{tr("Rechercher", "Search")}</span>
          <input
            className="input"
            type="search"
            placeholder={tr(
              "Outil, identifiant, empreinte…",
              "Tool, ID, fingerprint…",
            )}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <span>{tr("Verdict", "Verdict")}</span>
          <select
            className="input"
            value={verdict}
            onChange={(e) => setVerdict(e.target.value)}
          >
            <option value="">{tr("Tous", "All")}</option>
            {decisions.map((decision) => (
              <option key={decision}>{decision}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{tr("Du", "From")}</span>
          <input
            className="input"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          <span>{tr("Au", "To")}</span>
          <input
            className="input"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setRevision((n) => n + 1)}
        >
          {tr("Actualiser", "Refresh")}
        </button>
      </div>
      {error != null && (
        <ConsoleError error={error} retry={() => setRevision((n) => n + 1)} />
      )}
      {loading ? (
        <ConsoleSkeleton rows={6} />
      ) : (
        <>
          {entries.length > 0 && (
            <section className="console-panel console-chain">
              <div className="console-panel-heading">
                <h2>{tr("Fil des événements", "Event sequence")}</h2>
                <span className="console-count">
                  {filtered.length} / {entries.length}
                </span>
              </div>
              <AuditChain
                lang={lang}
                mode="live"
                events={filtered
                  .slice(0, 6)
                  .map((entry) => ({
                    id: String(entry.id),
                    label: entry.tool_name ?? "event",
                    verdict: entry.decision ?? undefined,
                    time: entry.ts ?? undefined,
                  }))}
                onSelect={(id: string) => setFocused(Number(id))}
              />
              <p className="console-note">
                {tr(
                  "Vue des événements chargés. L’API ne transmet pas les empreintes de chaînage ; cette vue ne certifie pas l’intégrité cryptographique.",
                  "Loaded events. The API does not expose chain hashes; this view does not certify cryptographic integrity.",
                )}
              </p>
            </section>
          )}
          <div className="console-panel console-table-wrap">
            <table className="data-table console-table">
              <thead>
                <tr>
                  <th>ID / {tr("Heure", "Time")}</th>
                  <th>{t("audit.col.tool")}</th>
                  <th>{t("scope.view")}</th>
                  <th>{t("audit.col.decision")}</th>
                  <th>{tr("Signaux", "Signals")}</th>
                  <th>args_hash</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id} data-selected={focused === entry.id}>
                    <td>
                      <button
                        type="button"
                        className="console-row-link"
                        onClick={() => setFocused(entry.id)}
                      >
                        #{entry.id}
                      </button>
                      <small>{localTime(entry.ts, lang)}</small>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="console-row-link console-mono"
                        onClick={() => setFocused(entry.id)}
                      >
                        {entry.tool_name ?? "—"}
                      </button>
                      <small>{entry.action_class}</small>
                    </td>
                    <td>
                      {agents.find(
                        (agent) => agent.id === entry.gateway_token_id,
                      )?.name ??
                        (entry.gateway_token_id
                          ? `${entry.gateway_token_id.slice(0, 8)}…`
                          : "—")}
                    </td>
                    <td>
                      <VerdictBadge value={entry.decision ?? "unknown"} />
                    </td>
                    <td>
                      {signalKinds(entry).map((signal) => (
                        <span className="console-signal-tag" key={signal}>
                          {signal}
                        </span>
                      ))}
                    </td>
                    <td className="console-mono">
                      {entry.args_hash?.slice(0, 12) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && !error && (
              <EmptyState
                title={
                  entries.length
                    ? tr("Aucun résultat.", "No results.")
                    : tr(
                        "Le journal attend son premier appel.",
                        "Waiting for the first call.",
                      )
                }
                description={
                  entries.length
                    ? tr(
                        "Modifiez les filtres pour retrouver un événement.",
                        "Change filters to find an event.",
                      )
                    : t("audit.empty")
                }
              />
            )}
          </div>
        </>
      )}
      {event && (
        <section
          className="console-panel audit-inspection"
          aria-label={tr("Détail de l’événement", "Event details")}
        >
          <div className="console-panel-heading">
            <h2>
              {tr("Événement", "Event")} #{event.id}
            </h2>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setFocused(null)}
            >
              {tr("Fermer", "Close")}
            </button>
          </div>
          <dl className="console-data-grid">
            <DataPair label={tr("Outil", "Tool")}>{event.tool_name}</DataPair>
            <DataPair label="decision">
              <VerdictBadge value={event.decision ?? "unknown"} />
            </DataPair>
            <DataPair label="policy_rule_id">{event.policy_rule_id}</DataPair>
            <DataPair label="request_id">{event.request_id}</DataPair>
            <DataPair label="args_hash">
              <code>{event.args_hash}</code>
            </DataPair>
            <DataPair label="timestamp">{localTime(event.ts, lang)}</DataPair>
            <DataPair label="ingress">{event.ingress}</DataPair>
            <DataPair label={tr("Latence", "Latency")}>
              {event.latency_ms != null ? `${event.latency_ms} ms` : "—"}
            </DataPair>
          </dl>
          {event.error && (
            <p className="console-event-error">
              <code>{event.error}</code>
            </p>
          )}
        </section>
      )}
    </section>
  );
}
