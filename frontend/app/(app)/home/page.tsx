"use client";
import Link from "next/link";
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
  EmptyState,
  localTime,
} from "@/components/ConsoleUI";
import { AuthorizationFlow, VerdictBadge } from "@/design-system/react";
import { apiGet } from "@/lib/client";
import { type AuditEntry, type ToolView } from "@/lib/console-types";
import { useT } from "@/lib/i18n";
export default function HomePage() {
  const { lang } = useT();
  const { selected } = useClientScope();
  const [tools, setTools] = useState<ToolView[] | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [events, setEvents] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const tr = (fr: string, en: string) => (lang === "fr" ? fr : en);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    Promise.allSettled([
      apiGet<ToolView[]>("v1/tools"),
      apiGet<unknown[]>("v1/approvals?status=pending"),
      apiGet<AuditEntry[]>(`v1/audit${clientSuffix(selected)}`),
    ]).then(([registry, queue, audit]) => {
      if (!current) return;
      setTools(registry.status === "fulfilled" ? registry.value : null);
      setPending(queue.status === "fulfilled" ? queue.value.length : null);
      setEvents(audit.status === "fulfilled" ? audit.value : null);
      const failed = [registry, queue, audit].find(
        (result) => result.status === "rejected",
      );
      if (failed?.status === "rejected") setError(failed.reason);
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [selected, revision]);
  const blocked = events?.filter((event) =>
    ["deny", "hitl_denied", "expired"].includes(event.decision ?? ""),
  ).length;
  return (
    <section className="console-page">
      <ConsoleHeader
        eyebrow="01 / CONTROL ROOM"
        title={tr(
          "L’agent propose. Vous contrôlez.",
          "The agent proposes. You control.",
        )}
        description={tr(
          "L’état des actions et des décisions, dans votre périmètre.",
          "Actions and decisions within your scope.",
        )}
        actions={
          <Link href="/inspector" className="btn btn-primary">
            {tr("Ouvrir l’inspecteur", "Open inspector")} ↗
          </Link>
        }
      />
      <ClientScopeBar />
      {error != null && (
        <ConsoleError error={error} retry={() => setRevision((n) => n + 1)} />
      )}
      {loading ? (
        <ConsoleSkeleton rows={2} />
      ) : (
        <div className="console-metrics">
          <div className="console-metric">
            <span>
              {tr("Outils déclarés · tenant", "Registered tools · tenant")}
            </span>
            <strong>{tools?.length ?? "—"}</strong>
            <Link href="/inspector">{tr("Registre", "Registry")} ↗</Link>
          </div>
          <div className="console-metric" data-attention={!!pending}>
            <span>{tr("À signer · tenant", "Awaiting approval · tenant")}</span>
            <strong>{pending ?? "—"}</strong>
            <Link href="/approvals">{tr("File HITL", "HITL queue")} ↗</Link>
          </div>
          <div className="console-metric">
            <span>{tr("Événements chargés", "Loaded events")}</span>
            <strong>{events?.length ?? "—"}</strong>
            <Link href="/audit">{tr("Journal", "Audit trail")} ↗</Link>
          </div>
          <div className="console-metric">
            <span>{tr("Refus dans le lot", "Denials in batch")}</span>
            <strong>{blocked ?? "—"}</strong>
            <Link href="/risk">
              {tr("Risque & intégrité", "Risk & integrity")} ↗
            </Link>
          </div>
        </div>
      )}
      <div className="overview-workspace">
        <section className="console-panel overview-flow">
          <div className="console-panel-heading">
            <div>
              <p className="console-kicker">ACTION CONTROL GATEWAY</p>
              <h2>
                {tr(
                  "L’action passe par la règle.",
                  "The rule precedes the action.",
                )}
              </h2>
            </div>
          </div>
          <AuthorizationFlow lang={lang} interactive={true} mode="demo" />
          <p className="console-note">
            {tr(
              "Schéma interactif de démonstration. Aucune action réelle n’est exécutée.",
              "Interactive demonstration diagram. No real action is executed.",
            )}
          </p>
          <div className="overview-links">
            <Link href="/onboarding">
              <span>01</span>
              <strong>{tr("Connecter", "Connect")}</strong>
              <small>{tr("Agent → MCP → Guard", "Agent → MCP → Guard")}</small>
            </Link>
            <Link href="/approvals">
              <span>02</span>
              <strong>{tr("Superviser", "Supervise")}</strong>
              <small>Dry-run / HITL</small>
            </Link>
            <Link href="/audit">
              <span>03</span>
              <strong>{tr("Prouver", "Evidence")}</strong>
              <small>Audit / AI Act / GDPR</small>
            </Link>
          </div>
        </section>
        <section className="console-panel">
          <div className="console-panel-heading">
            <h2>{tr("Dernières traces", "Recent traces")}</h2>
            <Link className="console-inline-link" href="/audit">
              {tr("Tout voir", "View all")} ↗
            </Link>
          </div>
          {loading ? (
            <ConsoleSkeleton />
          ) : events?.length ? (
            <ol className="overview-events">
              {[...events]
                .sort((a, b) => b.id - a.id)
                .slice(0, 6)
                .map((event) => (
                  <li key={event.id}>
                    <span className="console-event-number">#{event.id}</span>
                    <div>
                      <strong>{event.tool_name ?? "event"}</strong>
                      <small>{localTime(event.ts, lang)}</small>
                    </div>
                    <VerdictBadge value={event.decision ?? "unknown"} />
                  </li>
                ))}
            </ol>
          ) : events ? (
            <EmptyState
              title={tr("Première trace à venir.", "First trace to come.")}
              description={tr(
                "Les appels d’outils apparaîtront ici.",
                "Tool calls will appear here.",
              )}
            />
          ) : (
            <p className="console-note">
              {tr(
                "Le journal est indisponible.",
                "The audit trail is unavailable.",
              )}
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
