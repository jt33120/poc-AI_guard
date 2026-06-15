"use client";

import { useEffect, useState } from "react";

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
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit explorer</h1>
        <div className="flex gap-2 text-sm">
          <a className="rounded border px-3 py-1 hover:bg-slate-100" href={exportUrl("ai_act", "pdf")}>
            Export AI Act (PDF)
          </a>
          <a className="rounded border px-3 py-1 hover:bg-slate-100" href={exportUrl("rgpd", "json")}>
            Export GDPR (JSON)
          </a>
        </div>
      </div>
      {error ? <p className="text-red-600">{error}</p> : null}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">#</th>
            <th>Tool</th>
            <th>Class</th>
            <th>Decision</th>
            <th>args_hash</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b">
              <td className="py-2">{entry.id}</td>
              <td className="font-mono">{entry.tool_name ?? "—"}</td>
              <td>{entry.action_class ?? "—"}</td>
              <td>{entry.decision ?? "—"}</td>
              <td className="font-mono text-xs text-slate-400">
                {entry.args_hash ? entry.args_hash.slice(0, 12) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && !error ? <p className="text-slate-500">No audit entries.</p> : null}
    </section>
  );
}
