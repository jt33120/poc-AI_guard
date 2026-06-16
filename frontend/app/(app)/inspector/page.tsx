"use client";

import { useEffect, useState } from "react";

import { DecisionBadge } from "@/components/brand";
import { Spinner } from "@/components/Spinner";
import { apiGet } from "@/lib/client";

interface ToolView {
  name: string;
  canonical: string;
  action_class: string | null;
  decision: string;
}

export default function InspectorPage() {
  const [tools, setTools] = useState<ToolView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<ToolView[]>("v1/tools")
      .then(setTools)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="flex animate-fade-up flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold">Inspector</h1>
        <p className="muted mt-1">Tools exposed to the agent and their effective policy.</p>
      </header>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Canonical</th>
              <th>Class</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <tr key={tool.canonical}>
                <td className="font-mono text-white">{tool.name}</td>
                <td className="font-mono text-white/45">{tool.canonical}</td>
                <td>
                  {tool.action_class ? (
                    <span className="badge badge-neutral">{tool.action_class}</span>
                  ) : (
                    <span className="text-white/30">—</span>
                  )}
                </td>
                <td>
                  <DecisionBadge value={tool.decision} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading ? (
          <Spinner />
        ) : tools.length === 0 && !error ? (
          <p className="muted p-4">No tools exposed.</p>
        ) : null}
      </div>
    </section>
  );
}
