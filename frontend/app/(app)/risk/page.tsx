"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ConsoleError,
  ConsoleHeader,
  ConsoleSkeleton,
  EmptyState,
  localTime,
} from "@/components/ConsoleUI";
import { RiskMeter, VerdictBadge } from "@/design-system/react";
import { apiGet } from "@/lib/client";
import {
  type AuditEntry,
  type ToolView,
  signalKinds,
} from "@/lib/console-types";
import { useT } from "@/lib/i18n";

interface TrustRow {
  tool: string;
  seen_before: boolean;
  clean_streak: number;
  trusted: boolean;
}
interface IntegrityRow {
  server: string;
  tool_name: string;
  approved: boolean;
  status: string;
  first_seen: string | null;
  last_seen: string | null;
}
const CLASSES = ["read", "write", "external_send", "irreversible"];
const MODES = ["auto", "notify", "human_in_the_loop", "human_dual", "deny"];

export default function RiskPage() {
  const { lang } = useT();
  const [trust, setTrust] = useState<TrustRow[] | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityRow[] | null>(null);
  const [tools, setTools] = useState<ToolView[] | null>(null);
  const [events, setEvents] = useState<AuditEntry[] | null>(null);
  const [errors, setErrors] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const tr = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const reload = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    const results = await Promise.allSettled([
      apiGet<TrustRow[]>("v1/trust"),
      apiGet<IntegrityRow[]>("v1/tools/integrity"),
      apiGet<ToolView[]>("v1/tools"),
      apiGet<AuditEntry[]>("v1/audit"),
    ]);
    setTrust(results[0].status === "fulfilled" ? results[0].value : null);
    setIntegrity(results[1].status === "fulfilled" ? results[1].value : null);
    setTools(results[2].status === "fulfilled" ? results[2].value : null);
    setEvents(results[3].status === "fulfilled" ? results[3].value : null);
    setErrors(
      results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) => result.reason),
    );
    setLoading(false);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const signals = (events ?? []).filter(
    (event) => signalKinds(event).length > 0,
  );
  return (
    <section className="console-page">
      <ConsoleHeader
        eyebrow="05 / RISK & INTEGRITY"
        title={tr("La confiance se gagne.", "Trust is earned.")}
        description={tr(
          "Classes d’action, dérive des outils, validations propres.",
          "Action classes, tool drift, clean approvals.",
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
      {errors.length > 0 && <ConsoleError error={errors[0]} retry={reload} />}
      {loading ? (
        <ConsoleSkeleton rows={6} />
      ) : (
        <>
          <div className="risk-overview">
            <section className="console-panel">
              <div className="console-panel-heading">
                <h2>{tr("Score de risque", "Risk score")}</h2>
                <span className="console-kicker">SERVER AUTHORITY</span>
              </div>
              <RiskMeter lang={lang} score={null} trust={null} mode="live" />
              <p className="console-note">
                {tr(
                  "Le score par appel n’est pas exposé par cette API. Les classes et décisions ci-dessous viennent du moteur.",
                  "This API does not expose per-call scores. Classes and decisions below come from the engine.",
                )}
              </p>
            </section>
            <div className="risk-stats">
              <div className="console-metric">
                <span>{tr("Outils observés", "Observed tools")}</span>
                <strong>{integrity?.length ?? "—"}</strong>
              </div>
              <div className="console-metric">
                <span>{tr("Dérives déclarées", "Reported drifts")}</span>
                <strong>
                  {integrity?.filter((item) => item.status === "drift")
                    .length ?? "—"}
                </strong>
              </div>
              <div className="console-metric">
                <span>{tr("Confiance acquise", "Earned trust")}</span>
                <strong>
                  {trust?.filter((item) => item.trusted).length ?? "—"}
                </strong>
              </div>
              <div className="console-metric">
                <span>{tr("Signaux dans le lot", "Signals in batch")}</span>
                <strong>{events ? signals.length : "—"}</strong>
              </div>
            </div>
          </div>
          <section className="console-panel">
            <div className="console-panel-heading">
              <h2>{tr("Matrice d’escalade", "Escalation matrix")}</h2>
              <span className="console-kicker">
                {tr("Outils / règle effective", "Tools / effective rule")}
              </span>
            </div>
            <div className="console-table-wrap">
              <table className="data-table risk-matrix">
                <thead>
                  <tr>
                    <th>{tr("Classe", "Class")}</th>
                    {MODES.map((mode) => (
                      <th key={mode}>
                        <VerdictBadge value={mode} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CLASSES.map((actionClass) => (
                    <tr key={actionClass}>
                      <th scope="row">{actionClass}</th>
                      {MODES.map((mode) => {
                        const count = tools?.filter(
                          (tool) =>
                            tool.action_class === actionClass &&
                            tool.decision === mode,
                        ).length;
                        return (
                          <td key={mode} data-active={!!count}>
                            {count ?? "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="console-note">
              {tr(
                "Comptage des outils classés, pas une estimation de leur risque. Les outils non classés restent dans l’inspecteur.",
                "A count of classified tools, not a risk estimate. Unclassified tools remain in the inspector.",
              )}
            </p>
          </section>
          <div className="console-two-columns">
            <section className="console-panel">
              <div className="console-panel-heading">
                <h2>{tr("Empreintes des outils", "Tool fingerprints")}</h2>
              </div>
              {integrity === null ? (
                <p className="console-note">
                  {tr("État indisponible.", "Status unavailable.")}
                </p>
              ) : integrity.length ? (
                <ul className="risk-tool-list">
                  {integrity.map((item) => (
                    <li key={`${item.server}/${item.tool_name}`}>
                      <div>
                        <strong>{item.tool_name}</strong>
                        <span>
                          {item.server} · {localTime(item.last_seen, lang)}
                        </span>
                      </div>
                      <span
                        className="signal-tag"
                        data-verdict={
                          item.status === "ok"
                            ? "allow"
                            : item.status === "drift"
                              ? "drift"
                              : "notify"
                        }
                      >
                        {item.status}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title={tr("Aucune empreinte.", "No fingerprints.")}
                  description={tr(
                    "Elles apparaîtront à la découverte des outils MCP.",
                    "They appear when MCP tools are discovered.",
                  )}
                />
              )}
            </section>
            <section className="console-panel">
              <div className="console-panel-heading">
                <h2>{tr("Validations propres", "Clean approvals")}</h2>
              </div>
              {trust === null ? (
                <p className="console-note">
                  {tr("Confiance indisponible.", "Trust unavailable.")}
                </p>
              ) : trust.length ? (
                <ul className="risk-tool-list">
                  {trust.map((item) => (
                    <li key={item.tool}>
                      <div>
                        <strong>{item.tool}</strong>
                        <span>
                          {item.clean_streak}{" "}
                          {tr("consécutives", "consecutive")}
                        </span>
                      </div>
                      <span className="console-signal-tag">
                        {item.trusted
                          ? tr("Acquise", "Earned")
                          : tr("En observation", "Observing")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title={tr(
                    "La confiance commence à zéro.",
                    "Trust starts at zero.",
                  )}
                  description={tr(
                    "Aucun historique de validation pour ce tenant.",
                    "No approval history for this tenant.",
                  )}
                />
              )}
            </section>
          </div>
          <section className="console-panel">
            <div className="console-panel-heading">
              <h2>{tr("Signaux dans l’audit", "Audit signals")}</h2>
              <span className="console-kicker">
                DLP / TAINT / DRIFT / COST SPIKE
              </span>
            </div>
            {events === null ? (
              <p className="console-note">
                {tr("Audit indisponible.", "Audit unavailable.")}
              </p>
            ) : signals.length ? (
              <ul className="risk-tool-list">
                {signals.slice(0, 20).map((event) => (
                  <li key={event.id}>
                    <div>
                      <strong>{event.tool_name}</strong>
                      <span>
                        #{event.id} · {localTime(event.ts, lang)}
                      </span>
                    </div>
                    <span className="console-signal-tag">
                      {signalKinds(event).join(" · ")}
                    </span>
                    <VerdictBadge value={event.decision ?? "unknown"} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="console-note">
                {tr(
                  "Aucun de ces signaux dans les événements chargés. Cela ne garantit pas l’absence de risque.",
                  "None of these signals in the loaded events. This does not guarantee the absence of risk.",
                )}
              </p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
