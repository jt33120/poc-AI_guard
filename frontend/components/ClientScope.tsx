"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/client";
import { useT } from "@/lib/i18n";

export interface Client {
  id: string;
  name: string;
  website: string | null;
  agents: number;
  actions: number;
  est_cost_usd: number;
  billed_cost_usd: number;
  tokens: number;
}

export interface Agent {
  id: string;
  name: string;
  revoked: boolean;
  client_id: string | null;
  client_name: string | null;
}

interface AgentsOverview {
  customer: string | null;
  agents: Agent[];
}

interface ScopeValue {
  customer: string | null;
  clients: Client[];
  agents: Agent[];
  loading: boolean;
  /** Selected client id, or "all". */
  selected: string;
  setSelected: (v: string) => void;
  reload: () => void;
}

const ScopeContext = createContext<ScopeValue>({
  customer: null,
  clients: [],
  agents: [],
  loading: true,
  selected: "all",
  setSelected: () => {},
  reload: () => {},
});

const STORAGE_KEY = "xsom_client";

export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

export function ClientScopeProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelectedState] = useState("all");

  const reload = useCallback(() => {
    Promise.allSettled([apiGet<Client[]>("v1/clients"), apiGet<AgentsOverview>("v1/agents")])
      .then(([cl, ov]) => {
        const clientList = cl.status === "fulfilled" && Array.isArray(cl.value) ? cl.value : [];
        setClients(clientList);
        if (ov.status === "fulfilled") {
          setCustomer(ov.value?.customer ?? null);
          setAgents(Array.isArray(ov.value?.agents) ? ov.value.agents : []);
        }
        const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        if (saved && saved !== "all" && clientList.some((c) => c.id === saved)) {
          setSelectedState(saved);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => reload(), [reload]);

  const setSelected = useCallback((v: string) => {
    setSelectedState(v);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, v);
  }, []);

  const value = useMemo(
    () => ({ customer, clients, agents, loading, selected, setSelected, reload }),
    [customer, clients, agents, loading, selected, setSelected, reload],
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useClientScope(): ScopeValue {
  return useContext(ScopeContext);
}

/** Build the `?client_id=` suffix for the current selection (empty when "all"). */
export function clientSuffix(selected: string): string {
  return selected === "all" ? "" : `?client_id=${selected}`;
}

/** The monitored-client header: name + website + live rollup + selector. */
export function ClientScopeBar() {
  const { t } = useT();
  const { clients, loading, selected, setSelected } = useClientScope();

  const sel = selected === "all" ? null : clients.find((c) => c.id === selected);
  const roll = sel
    ? {
        agents: sel.agents,
        actions: sel.actions,
        billed: sel.billed_cost_usd,
        est: sel.est_cost_usd,
        tokens: sel.tokens,
      }
    : clients.reduce(
        (a, c) => ({
          agents: a.agents + c.agents,
          actions: a.actions + c.actions,
          billed: a.billed + c.billed_cost_usd,
          est: a.est + c.est_cost_usd,
          tokens: a.tokens + c.tokens,
        }),
        { agents: 0, actions: 0, billed: 0, est: 0, tokens: 0 },
      );

  const title = sel ? sel.name : t("scope.allclients");
  const initial = (sel ? sel.name : "*").slice(0, 1).toUpperCase();

  return (
    <div className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/15 text-sm font-bold text-brand-bright ring-1 ring-brand/30">
          {initial}
        </span>
        <div className="min-w-0">
          <div className="label text-brand-bright">{t("scope.clientlabel")}</div>
          <div className="truncate text-lg font-bold leading-tight">{title}</div>
          {sel?.website ? (
            <a
              href={sel.website}
              target="_blank"
              rel="noreferrer"
              className="muted truncate text-xs hover:text-white hover:underline"
            >
              {sel.website.replace(/^https?:\/\//, "")}
            </a>
          ) : (
            <div className="muted text-xs">
              {loading ? "…" : t("scope.nagents", { n: roll.agents })}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Stat label={t("scope.actions")} value={roll.actions.toLocaleString("en-US")} />
        <Stat label={t("scope.billed")} value={formatUsd(roll.billed)} />
        <Stat label={t("scope.spend")} value={formatUsd(roll.est)} />
        <Stat label={t("scope.tokens")} value={formatTokens(roll.tokens)} />
      </div>

      <div className="flex items-center gap-2">
        {clients.length === 0 && !loading ? (
          <Link href="/admin" className="text-sm font-semibold text-brand-bright hover:underline">
            {t("scope.manage")} →
          </Link>
        ) : (
          <select
            aria-label={t("scope.clientlabel")}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-brand/50"
          >
            <option value="all">{t("scope.allclients")}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-base font-bold leading-tight text-white">{value}</div>
      <div className="muted text-[11px] uppercase tracking-wide">{label}</div>
    </div>
  );
}
