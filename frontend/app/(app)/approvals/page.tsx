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
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Approval queue</h1>
      {error ? <p className="text-red-600">{error}</p> : null}
      {items.length === 0 ? <p className="text-slate-500">No pending approvals.</p> : null}
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id} className="rounded border border-slate-200 bg-white p-4">
            <div className="font-mono text-sm text-slate-500">{item.tool_name}</div>
            <div className="mt-1">{item.dry_run.summary ?? "(no dry-run)"}</div>
            <div className="mt-1 text-xs text-slate-500">
              approvals {item.approved_by.length}/{item.required_count}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => decide(item.id, "approve")}
                className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => decide(item.id, "deny")}
                className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-500"
              >
                Deny
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
