"use client";

import { useCallback, useEffect, useState } from "react";

import { apiDelete, apiGet, apiSend } from "@/lib/client";
import { useT } from "@/lib/i18n";

interface GatewayToken {
  id: string;
  name: string;
  created_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface CreatedToken extends GatewayToken {
  token: string;
}

export function ApiKeys() {
  const { t } = useT();
  const [tokens, setTokens] = useState<GatewayToken[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    apiGet<GatewayToken[]>("v1/gateway-tokens")
      .then(setTokens)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => reload(), [reload]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const token = await apiSend<CreatedToken>("v1/gateway-tokens", "POST", { name: name.trim() });
      setCreated(token);
      setName("");
      reload();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await apiDelete(`v1/gateway-tokens/${id}`);
      reload();
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  return (
    <div className="card p-5">
      <h2 className="text-lg font-semibold">{t("keys.title")}</h2>
      <p className="muted mt-1 text-sm">{t("keys.subtitle")}</p>

      <div className="mt-4 flex gap-2">
        <input
          aria-label={t("keys.title")}
          className="input"
          placeholder={t("keys.placeholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary shrink-0"
          onClick={create}
          disabled={busy || !name.trim()}
        >
          {t("keys.generate")}
        </button>
      </div>

      {created ? (
        <div className="mt-4 rounded-xl border border-brand/40 bg-brand/10 p-4">
          <p className="text-sm font-medium text-brand-bright">
            {t("keys.created", { name: created.name })}
          </p>
          <code className="mt-2 block break-all rounded-lg bg-navy-mid/70 px-3 py-2 font-mono text-xs text-white">
            {created.token}
          </code>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}

      <ul className="mt-4 flex flex-col gap-1.5 text-sm">
        {tokens.map((token) => (
          <li
            key={token.id}
            className="flex items-center gap-2 border-b border-white/[0.06] py-2 last:border-0"
          >
            <span className="font-mono text-white/90">{token.name}</span>
            {token.revoked_at ? (
              <span className="badge badge-red">{t("keys.revoked")}</span>
            ) : (
              <span className="badge badge-green">{t("keys.active")}</span>
            )}
            <span className="muted ml-auto text-xs">
              {token.last_used_at
                ? t("keys.used", { date: new Date(token.last_used_at).toLocaleDateString() })
                : t("keys.never")}
            </span>
            {!token.revoked_at ? (
              <button
                type="button"
                className="btn btn-ghost px-3 py-1 text-xs"
                onClick={() => revoke(token.id)}
              >
                {t("keys.revoke")}
              </button>
            ) : null}
          </li>
        ))}
        {tokens.length === 0 ? <li className="muted">{t("keys.empty")}</li> : null}
      </ul>
    </div>
  );
}
