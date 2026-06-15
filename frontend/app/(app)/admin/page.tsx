"use client";

import { useEffect, useState } from "react";

import { apiGet, apiSend } from "@/lib/client";

interface PolicyDoc {
  yaml: string;
  version: number;
}

interface ServerRow {
  id: string;
  name: string;
  transport: string;
  enabled: boolean;
}

export default function AdminPage() {
  const [yaml, setYaml] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<PolicyDoc>("v1/policy")
      .then((doc) => {
        setYaml(doc.yaml);
        setVersion(doc.version);
      })
      .catch((e: unknown) => setError(String(e)));
    apiGet<ServerRow[]>("v1/servers")
      .then(setServers)
      .catch(() => undefined);
  }, []);

  async function save() {
    setError(null);
    setMessage(null);
    try {
      const doc = await apiSend<PolicyDoc>("v1/policy", "PUT", { yaml });
      setVersion(doc.version);
      setMessage(`Policy saved (version ${doc.version}).`);
    } catch (e: unknown) {
      setError(`Invalid policy: ${String(e)}`);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Admin</h1>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Policy editor</h2>
          <span className="text-sm text-slate-500">version {version ?? "—"}</span>
        </div>
        <textarea
          aria-label="Policy YAML"
          value={yaml}
          onChange={(e) => setYaml(e.target.value)}
          rows={14}
          className="w-full rounded border border-slate-300 p-3 font-mono text-sm"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700"
          >
            Save policy
          </button>
          {message ? <span className="text-sm text-emerald-700">{message}</span> : null}
          {error ? <span className="text-sm text-red-600">{error}</span> : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Downstream servers</h2>
        <ul className="text-sm">
          {servers.map((server) => (
            <li key={server.id} className="border-b py-1">
              <span className="font-mono">{server.name}</span> · {server.transport} ·{" "}
              {server.enabled ? "enabled" : "disabled"}
            </li>
          ))}
          {servers.length === 0 ? <li className="text-slate-500">No servers declared.</li> : null}
        </ul>
      </div>
    </section>
  );
}
