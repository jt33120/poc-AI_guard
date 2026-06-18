"use client";

import { useCallback, useEffect, useState } from "react";

import { type Agent, type Client, useClientScope } from "@/components/ClientScope";
import { apiDelete, apiGet, apiSend, apiSendVoid } from "@/lib/client";
import { useT } from "@/lib/i18n";

const FIELD =
  "rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-brand/50";

export function ClientsManager() {
  const { t } = useT();
  const { reload } = useClientScope();
  const [clients, setClients] = useState<Client[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    apiGet<Client[]>("v1/clients")
      .then(setClients)
      .catch((e: unknown) => setError(String(e)));
    apiGet<{ agents: Agent[] }>("v1/agents")
      .then((o) => setAgents(Array.isArray(o.agents) ? o.agents : []))
      .catch(() => {});
  }, []);

  useEffect(() => refresh(), [refresh]);

  function syncScope() {
    refresh();
    reload();
  }

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend("v1/clients", "POST", {
        name: name.trim(),
        website: website.trim() || null,
      });
      setName("");
      setWebsite("");
      syncScope();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    try {
      await apiDelete(`v1/clients/${id}`);
      syncScope();
    } catch (e: unknown) {
      if (!String(e).includes("404")) setError(String(e));
      else syncScope();
    }
  }

  async function assign(tokenId: string, clientId: string) {
    try {
      await apiSendVoid("v1/clients/assign", "POST", {
        token_id: tokenId,
        client_id: clientId || null,
      });
      syncScope();
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  const activeAgents = agents.filter((a) => !a.revoked);

  return (
    <div className="card flex flex-col gap-4 p-6">
      <div>
        <h2 className="font-semibold">{t("clients.title")}</h2>
        <p className="muted mt-1 text-sm">{t("clients.subtitle")}</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("clients.name")}
          className={`${FIELD} sm:w-48`}
        />
        <input
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder={t("clients.website")}
          className={`${FIELD} grow`}
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !name.trim()}
          className="btn btn-primary px-4 py-2 disabled:opacity-50"
        >
          {t("clients.add")}
        </button>
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      {clients.length === 0 ? (
        <p className="muted text-sm">{t("clients.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {clients.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium">{c.name}</span>
                {c.website ? (
                  <span className="muted"> · {c.website.replace(/^https?:\/\//, "")}</span>
                ) : null}
                <span className="muted"> · {t("scope.nagents", { n: c.agents })}</span>
              </span>
              <button
                type="button"
                onClick={() => archive(c.id)}
                className="shrink-0 text-red-300 hover:underline"
              >
                {t("clients.archive")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div>
        <h3 className="label mt-1">{t("clients.agents.title")}</h3>
        {activeAgents.length === 0 ? (
          <p className="muted mt-2 text-sm">{t("clients.empty.agents")}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {activeAgents.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-mono">{a.name}</span>
                <select
                  aria-label={a.name}
                  value={a.client_id ?? ""}
                  onChange={(e) => assign(a.id, e.target.value)}
                  className={FIELD}
                >
                  <option value="">{t("clients.unassigned")}</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
