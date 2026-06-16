"use client";

import { useCallback, useEffect, useState } from "react";

import { apiGet, apiSend } from "@/lib/client";

interface Approval {
  id: string;
  tool_name: string;
  status: string;
  required_count: number;
  approved_by: string[];
  dry_run: { summary?: string };
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    apiGet<Approval[]>("v1/approvals?status=pending")
      .then(setItems)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => reload(), [reload]);

  async function decide(id: string, decision: "approve" | "deny") {
    setError(null);
    try {
      await apiSend(`v1/approvals/${id}/decision`, "POST", { decision });
      reload();
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  return (
    <section className="flex animate-fade-up flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold">Approval queue</h1>
        <p className="muted mt-1">Irreversible actions held for a human decision.</p>
      </header>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {items.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="muted">No pending approvals.</p>
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
              <span className="badge badge-amber shrink-0 capitalize">{item.status}</span>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="label">
                approvals {item.approved_by.length}/{item.required_count}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => decide(item.id, "approve")}
                  className="btn btn-success px-4 py-1.5"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => decide(item.id, "deny")}
                  className="btn btn-danger px-4 py-1.5"
                >
                  Deny
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
