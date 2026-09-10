"use client";

import { useCallback, useEffect, useState } from "react";
import { useConsoleRole } from "@/components/AppShell";
import {
  ConsoleError,
  ConsoleHeader,
  ConsoleSkeleton,
  EmptyState,
} from "@/components/ConsoleUI";
import { ApprovalCountdown, VerdictBadge } from "@/design-system/react";
import { signalFeedback } from "@/design-system/signal.js";
import { apiGet, apiSend } from "@/lib/client";
import { useT } from "@/lib/i18n";

interface Approval {
  id: string;
  request_id?: string;
  tool_name: string;
  action_class?: string | null;
  status: string;
  required_count: number;
  approved_by: string[];
  dry_run: { summary?: string };
  created_at?: string | null;
  expires_at?: string | null;
}

export default function ApprovalsPage() {
  const { t, lang } = useT();
  const role = useConsoleRole();
  const [items, setItems] = useState<Approval[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<{
    tool: string;
    status: string;
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [expired, setExpired] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<"grid" | "list">("list");
  const tr = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const reload = useCallback(async () => {
    try {
      setItems(await apiGet<Approval[]>("v1/approvals?status=pending"));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, 30_000);
    const focus = () => {
      void reload();
    };
    window.addEventListener("focus", focus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [reload]);
  async function decide(id: string, decision: "approve" | "deny") {
    if (busy || (role !== "admin" && role !== "operator")) return;
    const item = items.find((entry) => entry.id === id);
    if (!item || (item.expires_at && Date.parse(item.expires_at) <= Date.now()))
      return;
    setError(null);
    setReceipt(null);
    setBusy(id);
    try {
      const result = await apiSend<Approval>(
        `v1/approvals/${id}/decision`,
        "POST",
        { decision },
      );
      signalFeedback(
        result.status === "denied"
          ? "deny"
          : result.status === "approved"
            ? "allow"
            : "hitl",
      );
      setReceipt({
        tool: item.tool_name,
        status: result.status,
        text:
          result.status === "approved"
            ? t("approvals.approved")
            : result.status === "denied"
              ? t("approvals.denied")
              : t("approvals.recorded"),
      });
      if (result.status !== "pending")
        setItems((previous) => previous.filter((entry) => entry.id !== id));
      else
        setItems((previous) =>
          previous.map((entry) =>
            entry.id === id ? { ...entry, ...result } : entry,
          ),
        );
      await reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }
  const canDecide = role === "admin" || role === "operator";
  return (
    <section className="console-page">
      <ConsoleHeader
        eyebrow="03 / HUMAN IN THE LOOP"
        title={tr("À vous de trancher.", "Your call.")}
        description={tr(
          "L’action attend. À expiration, elle est refusée.",
          "The action waits. Expiry means deny.",
        )}
        actions={
          <>
            <div
              className="console-segment"
              role="group"
              aria-label={tr("Affichage", "View")}
            >
              {(["list", "grid"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={layout === view}
                  onClick={() => setLayout(view)}
                >
                  {view === "list" ? tr("Liste", "List") : tr("Grille", "Grid")}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost" onClick={reload}>
              {tr("Actualiser", "Refresh")}
            </button>
          </>
        }
      />
      <div className="console-queue-summary">
        <span>
          <strong>{loading || error ? "—" : items.length}</strong>{" "}
          {tr("en attente", "pending")}
        </span>
        <span className="console-kicker">EXPIRY = DENY</span>
        <span>{tr("Rafraîchissement · 30 s", "Refresh · 30 s")}</span>
      </div>
      {receipt && (
        <div
          className="approval-receipt"
          data-verdict={receipt.status}
          role="status"
        >
          <VerdictBadge value={receipt.status} />
          <div>
            <strong>{receipt.tool}</strong>
            <p>{receipt.text}</p>
          </div>
          <span aria-hidden="true">✓</span>
        </div>
      )}
      {error != null && <ConsoleError error={error} retry={reload} />}
      {!canDecide && (
        <p className="console-note">
          {tr(
            "Lecture seule. Un opérateur ou administrateur doit signer.",
            "Read only. An operator or administrator must sign.",
          )}
        </p>
      )}
      {loading ? (
        <ConsoleSkeleton rows={3} />
      ) : items.length === 0 && !error ? (
        <EmptyState
          title={tr("Rien à signer.", "Nothing to sign.")}
          description={t("approvals.empty")}
        />
      ) : null}
      <ul className="approval-queue" data-layout={layout}>
        {items.map((item) => {
          const isExpired =
            expired.has(item.id) ||
            !!(item.expires_at && Date.parse(item.expires_at) <= Date.now());
          return (
            <li
              key={item.id}
              className="approval-card"
              data-expired={isExpired}
              aria-busy={busy === item.id}
            >
              <div className="approval-card-heading">
                <div>
                  <p className="console-kicker">
                    {item.action_class ?? "HITL"}
                  </p>
                  <h2>{item.tool_name}</h2>
                  <code className="approval-request">
                    {item.request_id ?? item.id}
                  </code>
                </div>
                <VerdictBadge value={isExpired ? "expired" : item.status} />
              </div>
              <div className="approval-dryrun">
                <span className="console-kicker">DRY-RUN</span>
                <p>
                  {item.dry_run?.summary ??
                    tr(
                      "Aucun résumé fourni. Vérifiez l’effet avant de signer.",
                      "No summary provided. Review the effect before signing.",
                    )}
                </p>
              </div>
              <div className="approval-card-bottom">
                <div className="approval-timing">
                  {item.expires_at ? (
                    <ApprovalCountdown
                      expiresAt={item.expires_at}
                      lang={lang}
                      onExpire={() =>
                        setExpired((previous) => new Set(previous).add(item.id))
                      }
                    />
                  ) : (
                    <span className="console-note">
                      {tr("Expiration non fournie", "Expiry not provided")}
                    </span>
                  )}
                  <span className="console-signatures">
                    {item.approved_by.length}/{item.required_count}{" "}
                    {tr("signatures", "signatures")}
                  </span>
                </div>
                <div className="console-actions">
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => decide(item.id, "deny")}
                    disabled={!!busy || isExpired || !canDecide}
                  >
                    {t("approvals.deny")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => decide(item.id, "approve")}
                    disabled={!!busy || isExpired || !canDecide}
                  >
                    {busy === item.id
                      ? t("approvals.deciding")
                      : t("approvals.approve")}
                  </button>
                </div>
              </div>
              {isExpired && (
                <p className="approval-expired-note">
                  {tr(
                    "Délai dépassé. Toute validation sera refusée par le serveur.",
                    "Time elapsed. The server will reject any approval.",
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
