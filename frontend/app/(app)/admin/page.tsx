"use client";

import { useEffect, useState } from "react";

import { ApiKeys } from "@/components/ApiKeys";
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
    <section className="flex animate-fade-up flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="muted mt-1">Authorization policy and downstream tool servers.</p>
      </header>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Policy editor</h2>
          <span className="badge badge-neutral">version {version ?? "—"}</span>
        </div>
        <textarea
          aria-label="Policy YAML"
          value={yaml}
          onChange={(e) => setYaml(e.target.value)}
          rows={14}
          className="input mt-3 resize-y font-mono text-[13px] leading-relaxed"
        />
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={save} className="btn btn-primary">
            Save policy
          </button>
          {message ? <span className="text-sm text-emerald-300">{message}</span> : null}
          {error ? <span className="text-sm text-red-300">{error}</span> : null}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-lg font-semibold">Downstream servers</h2>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {servers.map((server) => (
            <li
              key={server.id}
              className="flex items-center gap-2 border-b border-white/[0.06] py-2 last:border-0"
            >
              <span className="font-mono text-white/90">{server.name}</span>
              <span className="badge badge-neutral">{server.transport}</span>
              <span className={`badge ${server.enabled ? "badge-green" : "badge-red"}`}>
                {server.enabled ? "enabled" : "disabled"}
              </span>
            </li>
          ))}
          {servers.length === 0 ? <li className="muted">No servers declared.</li> : null}
        </ul>
      </div>

      <ApiKeys />
    </section>
  );
}
