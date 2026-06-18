"use client";

import { useCallback, useEffect, useState } from "react";

import { apiDelete, apiGet, apiSend } from "@/lib/client";
import { useT } from "@/lib/i18n";

interface Credential {
  id: string;
  provider: string;
  label: string;
  created_at: string | null;
  last_used_at: string | null;
  revoked: boolean;
}

const PROVIDERS: [string, string][] = [
  ["openrouter", "OpenRouter"],
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["mistral", "Mistral"],
  ["azure", "Azure OpenAI"],
  ["aws", "AWS Bedrock"],
  ["gcp", "GCP Vertex"],
];

const FIELD = "rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-brand/50";

export function ProviderCredentials() {
  const { t } = useT();
  const [creds, setCreds] = useState<Credential[]>([]);
  const [provider, setProvider] = useState("openrouter");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const reload = useCallback(() => {
    apiGet<Credential[]>("v1/credentials")
      .then(setCreds)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => reload(), [reload]);

  async function connect() {
    if (!label.trim() || !secret.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend("v1/credentials", "POST", {
        provider,
        label: label.trim(),
        secret: secret.trim(),
      });
      setLabel("");
      setSecret("");
      reload();
    } catch (e: unknown) {
      const s = String(e);
      setError(s.includes("503") ? t("creds.unavailable") : s);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setRevoking(id);
    setError(null);
    try {
      await apiDelete(`v1/credentials/${id}`);
      reload();
    } catch (e: unknown) {
      if (!String(e).includes("404")) setError(String(e));
      else reload();
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="card flex flex-col gap-4 p-6">
      <div>
        <h2 className="font-semibold">{t("creds.title")}</h2>
        <p className="muted mt-1 text-sm">{t("creds.subtitle")}</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          aria-label={t("creds.provider")}
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className={FIELD}
        >
          {PROVIDERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("creds.label")}
          className={`${FIELD} sm:w-40`}
        />
        <input
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          type="password"
          placeholder={t("creds.secret")}
          className={`${FIELD} grow`}
        />
        <button
          type="button"
          onClick={connect}
          disabled={busy || !label.trim() || !secret.trim()}
          className="btn btn-primary px-4 py-2 disabled:opacity-50"
        >
          {t("creds.connect")}
        </button>
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      {creds.length === 0 ? (
        <p className="muted text-sm">{t("creds.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {creds.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium capitalize">{c.provider}</span>{" "}
                <span className="text-white/60">· {c.label}</span>
              </span>
              {c.revoked ? (
                <span className="badge badge-red">{t("creds.revoked")}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => revoke(c.id)}
                  disabled={revoking === c.id}
                  className="text-red-300 hover:underline disabled:opacity-50"
                >
                  {t("creds.revoke")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
