"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ConsoleError,
  ConsoleHeader,
  ConsoleSkeleton,
  DataPair,
  EmptyState,
  localTime,
} from "@/components/ConsoleUI";
import { AuthorizationFlow, VerdictBadge } from "@/design-system/react";
import { apiGet } from "@/lib/client";
import {
  type AuditEntry,
  type ToolView,
  signalKinds,
} from "@/lib/console-types";
import { useT } from "@/lib/i18n";

export default function InspectorPage() {
  const { lang } = useT();
  const [tools, setTools] = useState<ToolView[]>([]);
  const [events, setEvents] = useState<AuditEntry[]>([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [auditError, setAuditError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [eventId, setEventId] = useState<number | null>(null);
  const tr = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAuditError(null);
    const [registry, audit] = await Promise.allSettled([
      apiGet<ToolView[]>("v1/tools"),
      apiGet<AuditEntry[]>("v1/audit"),
    ]);
    if (registry.status === "fulfilled") setTools(registry.value);
    else setError(registry.reason);
    if (audit.status === "fulfilled") setEvents(audit.value);
    else setAuditError(audit.reason);
    setLoading(false);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const filtered = tools.filter((tool) =>
    `${tool.name} ${tool.canonical} ${tool.action_class ?? ""} ${tool.decision}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const tool =
    filtered.find((item) => item.canonical === selected) ?? filtered[0];
  const timeline = tool
    ? events
        .filter(
          (event) =>
            event.tool_name === tool.canonical || event.tool_name === tool.name,
        )
        .sort((a, b) => b.id - a.id)
    : [];
  const event = timeline.find((item) => item.id === eventId) ?? timeline[0];

  return (
    <section className="console-page">
      <ConsoleHeader
        eyebrow="02 / CONTROL"
        title={tr("L’action, sous contrôle.", "The action, under control.")}
        description={tr(
          "Un outil. Sa règle. Le verdict enregistré.",
          "One tool. Its rule. The recorded verdict.",
        )}
        actions={
          <button
            type="button"
            className="btn btn-ghost"
            onClick={reload}
            disabled={loading}
          >
            {tr("Actualiser", "Refresh")}
          </button>
        }
      />
      {error != null && <ConsoleError error={error} retry={reload} />}
      {loading ? (
        <ConsoleSkeleton rows={6} />
      ) : tools.length === 0 && !error ? (
        <EmptyState
          title={tr("Aucun outil déclaré.", "No registered tools.")}
          description={tr(
            "Connectez un agent pour inspecter ses règles effectives.",
            "Connect an agent to inspect its effective rules.",
          )}
          action={
            <Link className="btn btn-primary" href="/onboarding">
              {tr("Connecter un agent", "Connect an agent")}
            </Link>
          }
        />
      ) : (
        <div className="inspector-workspace">
          <section
            className="console-panel inspector-registry"
            aria-label={tr("Registre des outils", "Tool registry")}
          >
            <div className="console-panel-heading">
              <h2>{tr("Registre", "Registry")}</h2>
              <span className="console-count">{tools.length}</span>
            </div>
            <label className="console-search">
              <span className="sr-only">
                {tr("Filtrer les outils", "Filter tools")}
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tr(
                  "Outil, classe, verdict…",
                  "Tool, class, verdict…",
                )}
              />
            </label>
            <ul className="inspector-tools">
              {filtered.map((item) => (
                <li key={item.canonical}>
                  <button
                    type="button"
                    aria-pressed={tool?.canonical === item.canonical}
                    onClick={() => {
                      setSelected(item.canonical);
                      setEventId(null);
                    }}
                  >
                    <span className="inspector-tool-name">{item.name}</span>
                    <span className="inspector-tool-meta">
                      <span>
                        {item.action_class ?? tr("Non classé", "Unclassified")}
                      </span>
                      <VerdictBadge value={item.decision} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length === 0 && (
              <p className="console-note">
                {tr("Aucun outil ne correspond.", "No matching tools.")}
              </p>
            )}
          </section>
          <div className="inspector-detail">
            {tool && (
              <>
                <section className="console-panel">
                  <div className="console-panel-heading">
                    <div>
                      <p className="console-kicker">
                        {tr("Règle effective", "Effective rule")}
                      </p>
                      <h2 className="console-tool-title">{tool.canonical}</h2>
                    </div>
                    <VerdictBadge value={tool.decision} />
                  </div>
                  <AuthorizationFlow
                    lang={lang}
                    verdict={tool.decision}
                    interactive={false}
                    mode="live"
                  />
                  <p className="console-note">
                    {tr(
                      "Lecture de la policy. Aucun appel d’outil n’est exécuté depuis cet écran.",
                      "Policy inspection. This screen does not execute any tool calls.",
                    )}
                  </p>
                </section>
                <section className="console-panel">
                  <div className="console-panel-heading">
                    <h2>{tr("Récit d’un appel", "A call, step by step")}</h2>
                    {event && (
                      <span className="console-count">#{event.id}</span>
                    )}
                  </div>
                  {auditError ? (
                    <ConsoleError error={auditError} retry={reload} />
                  ) : event ? (
                    <>
                      <label className="console-event-select">
                        <span>{tr("Événement", "Event")}</span>
                        <select
                          className="input"
                          value={event.id}
                          onChange={(e) => setEventId(Number(e.target.value))}
                        >
                          {timeline.map((item) => (
                            <option key={item.id} value={item.id}>
                              #{item.id} · {localTime(item.ts, lang)} ·{" "}
                              {item.decision}
                            </option>
                          ))}
                        </select>
                      </label>
                      <ol className="inspector-strip">
                        <li>
                          <span>01 / INTENT</span>
                          <strong>
                            {event.action_class ??
                              tr("Non classé", "Unclassified")}
                          </strong>
                          <code>
                            {event.request_id ??
                              tr("Identifiant absent", "No request ID")}
                          </code>
                        </li>
                        <li>
                          <span>02 / POLICY</span>
                          <strong>
                            {event.policy_rule_id ??
                              tr("Règle non renseignée", "Rule not reported")}
                          </strong>
                          <small>
                            {event.judge_used
                              ? tr(
                                  "Classification assistée",
                                  "Assisted classification",
                                )
                              : tr("Décision du moteur", "Engine decision")}
                          </small>
                        </li>
                        <li>
                          <span>03 / VERDICT</span>
                          <VerdictBadge value={event.decision ?? "unknown"} />
                          <small>{localTime(event.ts, lang)}</small>
                        </li>
                        <li>
                          <span>04 / TRACE</span>
                          <strong>
                            {event.error
                              ? tr("Signal enregistré", "Recorded signal")
                              : tr("Événement journalisé", "Event recorded")}
                          </strong>
                          <small>
                            {event.latency_ms != null
                              ? `${event.latency_ms} ms`
                              : tr(
                                  "Latence non renseignée",
                                  "Latency not reported",
                                )}
                          </small>
                        </li>
                      </ol>
                      <dl className="console-data-grid">
                        <DataPair label="args_hash">
                          <code>{event.args_hash ?? "—"}</code>
                        </DataPair>
                        <DataPair label={tr("Plan d’entrée", "Ingress")}>
                          {event.ingress ?? "—"}
                        </DataPair>
                        <DataPair
                          label={tr("Mode d’exécution", "Enforcement mode")}
                        >
                          {event.enforcement_mode ?? "—"}
                        </DataPair>
                        <DataPair label={tr("Signaux", "Signals")}>
                          {signalKinds(event).length
                            ? signalKinds(event).join(" · ")
                            : tr("Aucun signal déclaré", "No reported signal")}
                        </DataPair>
                      </dl>
                      {event.error && (
                        <p className="console-event-error">
                          <code>{event.error}</code>
                        </p>
                      )}
                      <p className="console-note">
                        {tr(
                          "Métadonnées seules. Le verdict ne prouve pas à lui seul les effets dans l’outil aval.",
                          "Metadata only. A verdict alone does not prove downstream side effects.",
                        )}
                      </p>
                    </>
                  ) : (
                    <EmptyState
                      title={tr("Pas encore de trace.", "No trace yet.")}
                      description={tr(
                        "La règle existe. Aucun appel de cet outil dans les événements chargés.",
                        "The rule exists. No calls for this tool in the loaded events.",
                      )}
                    />
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
