"use client";

import { useEffect, useState } from "react";

import { ApiKeys } from "@/components/ApiKeys";
import { ProviderCredentials } from "@/components/ProviderCredentials";
import { apiGet, apiSend } from "@/lib/client";
import { useT } from "@/lib/i18n";

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
  const { t } = useT();
  const [yaml, setYaml] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [drafting, setDrafting] = useState(false);

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
      setMessage(t("admin.policy.saved", { v: doc.version }));
    } catch (e: unknown) {
      setError(`${t("admin.policy.invalid")} ${String(e)}`);
    }
  }

  async function draftWithAI() {
    if (!prompt.trim()) return;
    setDrafting(true);
    setError(null);
    setMessage(null);
    try {
      const doc = await apiSend<PolicyDoc>("v1/policy/draft", "POST", { prompt: prompt.trim() });
      setYaml(doc.yaml);
      setMessage(t("admin.ai.review"));
    } catch (e: unknown) {
      const s = String(e);
      setError(s.includes("503") ? t("admin.ai.unavailable") : t("admin.ai.error"));
    } finally {
      setDrafting(false);
    }
  }

  return (
    <section className="flex animate-fade-up flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">{t("admin.title")}</h1>
        <p className="muted mt-1">{t("admin.subtitle")}</p>
      </header>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("admin.policy.title")}</h2>
          <span className="badge badge-neutral">version {version ?? "—"}</span>
        </div>

        {/* Natural-language → policy (Mistral assistant) */}
        <div className="mt-3 rounded-xl border border-brand/30 bg-brand/[0.06] p-4">
          <div className="flex items-center gap-2">
            <span className="badge badge-blue">AI</span>
            <h3 className="text-sm font-semibold">{t("admin.ai.title")}</h3>
          </div>
          <textarea
            aria-label={t("admin.ai.title")}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder={t("admin.ai.ph")}
            className="input mt-2 resize-y text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={draftWithAI}
              disabled={drafting || !prompt.trim()}
              className="btn btn-primary px-4 py-1.5"
            >
              {drafting ? t("admin.ai.generating") : t("admin.ai.generate")}
            </button>
            <p className="muted text-xs">{t("admin.ai.hint")}</p>
          </div>
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
            {t("admin.policy.save")}
          </button>
          {message ? <span className="text-sm text-emerald-300">{message}</span> : null}
          {error ? <span className="text-sm text-red-300">{error}</span> : null}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-lg font-semibold">{t("admin.servers.title")}</h2>
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
          {servers.length === 0 ? <li className="muted">{t("admin.servers.empty")}</li> : null}
        </ul>
      </div>

      <ApiKeys />
      <ProviderCredentials />
    </section>
  );
}
