"use client";

import { useCallback, useEffect, useState } from "react";

import { Spinner } from "@/components/Spinner";
import { apiGet, apiSend } from "@/lib/client";
import { useT } from "@/lib/i18n";

interface Approval {
  id: string;
  tool_name: string;
  status: string;
  required_count: number;
  approved_by: string[];
  dry_run: { summary?: string };
}

export default function ApprovalsPage() {
  const { t } = useT();
  const [items, setItems] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    apiGet<Approval[]>("v1/approvals?status=pending")
      .then(setItems)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => reload(), [reload]);

  async function decide(id: string, decision: "approve" | "deny") {
    if (busy) return;
    setError(null);
    setMessage(null);
    setBusy(id);
    try {
      const r = await apiSend<{ status: string }>(`v1/approvals/${id}/decision`, "POST", {
        decision,
      });
      setMessage(
        r.status === "approved"
          ? t("approvals.approved")
          : r.status === "denied"
            ? t("approvals.denied")
            : t("approvals.recorded"),
      );
      reload();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex animate-fade-up flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold">{t("approvals.title")}</h1>
        <p className="muted mt-1">{t("approvals.subtitle")}</p>
      </header>
      {message ? (
        <div className="rounded-xl border border-brand/30 bg-brand/10 px-4 py-2.5 text-sm text-brand-bright">
          {message}
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {loading ? (
        <div className="card">
          <Spinner label={t("common.loading")} slowLabel={t("common.waking")} />
        </div>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="muted">{t("approvals.empty")}</p>
        </div>
      ) : null}
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id} className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-mono text-xs text-brand-bright">{item.tool_name}</div>
                <div className="mt-1.5 text-white/90">{item.dry_run.summary ?? "(no dry-run)"}</div>
              </div>
              <span className="badge badge-amber shrink-0">
                {item.status === "pending" ? t("approvals.status.pending") : item.status}
              </span>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="label">
                {t("approvals.count")} {item.approved_by.length}/{item.required_count}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => decide(item.id, "approve")}
                  disabled={busy === item.id}
                  className="btn btn-success px-4 py-1.5"
                >
                  {busy === item.id ? t("approvals.deciding") : t("approvals.approve")}
                </button>
                <button
                  type="button"
                  onClick={() => decide(item.id, "deny")}
                  disabled={busy === item.id}
                  className="btn btn-danger px-4 py-1.5"
                >
                  {t("approvals.deny")}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
