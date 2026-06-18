"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/client";
import { useT } from "@/lib/i18n";

export interface Agent {
  id: string;
  name: string;
  revoked: boolean;
  actions: number;
  spend_usd: number;
  tokens: number;
  last_active: string | null;
  created_at: string | null;
}

interface Overview {
  customer: string | null;
  agent_count: number;
  agents: Agent[];
}

interface ScopeValue {
  customer: string | null;
  agents: Agent[];
  loading: boolean;
  /** Selected agent id, or "all". */
  selected: string;
  setSelected: (v: string) => void;
  /** Append the agent filter to an API path (no-op when "all"). */
  withAgent: (path: string) => string;
}

const ScopeContext = createContext<ScopeValue>({
  customer: null,
  agents: [],
  loading: true,
  selected: "all",
  setSelected: () => {},
  withAgent: (p) => p,
});

const STORAGE_KEY = "xsom_agent";

export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

export function AgentScopeProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelectedState] = useState("all");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    apiGet<Overview>("v1/agents")
      .then((ov) => {
        setCustomer(ov?.customer ?? null);
        const list = Array.isArray(ov?.agents) ? ov.agents : [];
        setAgents(list);
        // Restore the saved selection only if that agent still exists.
        if (saved && saved !== "all" && list.some((a) => a.id === saved)) {
          setSelectedState(saved);
        }
      })
      .catch(() => {
        setAgents([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const setSelected = useCallback((v: string) => {
    setSelectedState(v);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, v);
  }, []);

  const withAgent = useCallback(
    (path: string): string =>
      selected === "all"
        ? path
        : path + (path.includes("?") ? "&" : "?") + `agent_id=${selected}`,
    [selected],
  );

  const value = useMemo(
    () => ({ customer, agents, loading, selected, setSelected, withAgent }),
    [customer, agents, loading, selected, setSelected, withAgent],
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useAgentScope(): ScopeValue {
  return useContext(ScopeContext);
}

/** Customer + monitored-agent count + an all/one selector with a live rollup. */
export function AgentScopeBar() {
  const { t } = useT();
  const { customer, agents, loading, selected, setSelected } = useAgentScope();

  const active = agents.filter((a) => !a.revoked);
  const sel = selected === "all" ? null : agents.find((a) => a.id === selected);
  const roll = sel
    ? { actions: sel.actions, spend: sel.spend_usd, tokens: sel.tokens }
    : agents.reduce(
        (acc, a) => ({
          actions: acc.actions + a.actions,
          spend: acc.spend + a.spend_usd,
          tokens: acc.tokens + a.tokens,
        }),
        { actions: 0, spend: 0, tokens: 0 },
      );

  const countLabel =
    active.length === 1 ? t("scope.agent_one") : t("scope.agents", { n: active.length });

  return (
    <div className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/15 text-sm font-bold text-brand-bright ring-1 ring-brand/30">
          {(customer ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="label text-brand-bright">{t("scope.customer")}</div>
          <div className="truncate text-lg font-bold leading-tight">{customer ?? "—"}</div>
          <div className="muted text-xs">{loading ? "…" : countLabel}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Stat label={t("scope.actions")} value={roll.actions.toLocaleString("en-US")} />
        <Stat label={t("scope.spend")} value={formatUsd(roll.spend)} />
        <Stat label={t("scope.tokens")} value={formatTokens(roll.tokens)} />
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="agent-scope" className="label whitespace-nowrap">
          {t("scope.view")}
        </label>
        {active.length === 0 && !loading ? (
          <Link href="/onboarding" className="text-sm font-semibold text-brand-bright hover:underline">
            {t("scope.connect")} →
          </Link>
        ) : (
          <select
            id="agent-scope"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-brand/50"
          >
            <option value="all">{t("scope.all")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.revoked ? " (revoked)" : ""}
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
