"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    apiGet<ToolView[]>("v1/tools")
      .then(setTools)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Inspector</h1>
      <p className="text-slate-600">Tools exposed to the agent and their effective policy.</p>
      {error ? <p className="text-red-600">{error}</p> : null}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Tool</th>
            <th>Canonical</th>
            <th>Class</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => (
            <tr key={tool.canonical} className="border-b">
              <td className="py-2 font-mono">{tool.name}</td>
              <td className="font-mono text-slate-500">{tool.canonical}</td>
              <td>{tool.action_class ?? "—"}</td>
              <td>{tool.decision}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tools.length === 0 && !error ? <p className="text-slate-500">No tools exposed.</p> : null}
    </section>
  );
}
