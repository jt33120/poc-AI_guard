"use client";

import { useEffect, useState } from "react";

import { DecisionBadge } from "@/components/brand";
import { apiGet, exportUrl } from "@/lib/client";

interface AuditEntry {
  id: number;
  ts: string | null;
  tool_name: string | null;
  action_class: string | null;
  decision: string | null;
  args_hash: string | null;
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<AuditEntry[]>("v1/audit")
      .then(setEntries)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <section className="flex animate-fade-up flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Audit explorer</h1>
          <p className="muted mt-1">Immutable, hash-chained record of every decision.</p>
        </div>
        <div className="flex gap-2">
          <a className="btn btn-ghost px-4 py-1.5" href={exportUrl("ai_act", "pdf")}>
            Export AI Act (PDF)
          </a>
          <a className="btn btn-ghost px-4 py-1.5" href={exportUrl("rgpd", "json")}>
            Export GDPR (JSON)
          </a>
        </div>
      </header>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Tool</th>
              <th>Class</th>
              <th>Decision</th>
              <th>args_hash</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="text-white/45">{entry.id}</td>
                <td className="font-mono">{entry.tool_name ?? "—"}</td>
                <td>{entry.action_class ?? "—"}</td>
                <td>
                  <DecisionBadge value={entry.decision} />
                </td>
                <td className="font-mono text-xs text-white/35">
                  {entry.args_hash ? entry.args_hash.slice(0, 12) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && !error ? <p className="muted p-4">No audit entries.</p> : null}
      </div>
    </section>
  );
}
