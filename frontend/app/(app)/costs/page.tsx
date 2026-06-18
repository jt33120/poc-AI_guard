"use client";

import { useEffect, useState } from "react";

import {
  AgentScopeBar,
  formatTokens,
  formatUsd,
  useAgentScope,
} from "@/components/AgentScope";
import { Spinner } from "@/components/Spinner";
import { apiGet } from "@/lib/client";
import { type StrKey, useT } from "@/lib/i18n";

interface Bucket {
  key: string;
  cost_usd: number;
  tokens: number;
  calls: number;
}
interface Daily {
  date: string;
  cost_usd: number;
  tokens: number;
}
interface Usage {
  total_cost_usd: number;
  billed_cost_usd: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  calls: number;
  by_provider: Bucket[];
  by_model: Bucket[];
  by_agent: Bucket[];
  daily: Daily[];
}

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  mistral: "Mistral",
  openrouter: "OpenRouter",
};

export default function CostsPage() {
  const { t } = useT();
  const { selected, agents } = useAgentScope();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const path = selected === "all" ? "v1/usage" : `v1/usage?agent_id=${selected}`;
    setLoading(true);
    setError(null);
    apiGet<Usage>(path)
      .then(setUsage)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selected]);

  const agentLabel = (id: string) =>
    id === "unknown"
      ? t("costs.unknown_agent")
      : (agents.find((a) => a.id === id)?.name ?? `${id.slice(0, 8)}…`);

  const KPIS: { value: string; label: StrKey; tone: string }[] = usage
    ? [
        { value: formatUsd(usage.total_cost_usd), label: "costs.kpi.spend", tone: "text-brand-bright" },
        { value: formatTokens(usage.total_tokens), label: "costs.kpi.tokens", tone: "text-white" },
        { value: usage.calls.toLocaleString("en-US"), label: "costs.kpi.calls", tone: "text-white" },
        {
          value: `${formatTokens(usage.prompt_tokens)} / ${formatTokens(usage.completion_tokens)}`,
          label: "costs.kpi.io",
          tone: "text-white/80",
        },
      ]
    : [];

  return (
    <section className="flex animate-fade-up flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">{t("costs.title")}</h1>
        <p className="muted mt-1.5 max-w-3xl">{t("costs.subtitle")}</p>
      </header>

      <AgentScopeBar />

      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      {loading ? (
        <div className="card">
          <Spinner label={t("common.loading")} slowLabel={t("common.waking")} />
        </div>
      ) : !usage || usage.calls === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <h2 className="text-lg font-semibold">{t("costs.empty.title")}</h2>
          <p className="muted max-w-md text-sm">{t("costs.empty.body")}</p>
        </div>
      ) : (
        <>
          {/* Billed (exact) vs estimated reconciliation */}
          <Reconciliation
            billed={usage.billed_cost_usd}
            estimated={usage.total_cost_usd}
            t={t}
          />

          {/* Headline KPIs */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {KPIS.map((k) => (
              <div key={k.label} className="card p-5">
                <div className={`text-2xl font-extrabold tracking-tight sm:text-3xl ${k.tone}`}>
                  {k.value}
                </div>
                <div className="muted mt-1.5 text-sm leading-snug">{t(k.label)}</div>
              </div>
            ))}
          </div>

          {/* Daily trend */}
          {usage.daily.length > 0 ? (
            <div className="card p-6">
              <h2 className="font-semibold">{t("costs.trend")}</h2>
              <TrendBars daily={usage.daily} />
            </div>
          ) : null}

          {/* Breakdowns */}
          <div className="grid gap-4 lg:grid-cols-3">
            <BucketCard
              title={t("costs.by_provider")}
              rows={usage.by_provider}
              label={(k) => PROVIDER_LABEL[k] ?? k}
              t={t}
            />
            <BucketCard
              title={t("costs.by_agent")}
              rows={usage.by_agent}
              label={agentLabel}
              t={t}
            />
            <BucketCard title={t("costs.by_model")} rows={usage.by_model} label={(k) => k} t={t} />
          </div>

          <p className="muted text-center text-xs">{t("costs.estimate.note")}</p>
        </>
      )}
    </section>
  );
}

function Reconciliation({
  billed,
  estimated,
  t,
}: {
  billed: number;
  estimated: number;
  t: (k: StrKey) => string;
}) {
  const drift = billed > 0 ? ((estimated - billed) / billed) * 100 : 0;
  return (
    <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div>
          <div className="text-2xl font-extrabold tracking-tight text-emerald-300 sm:text-3xl">
            {billed > 0 ? formatUsd(billed) : "—"}
          </div>
          <div className="muted mt-1 text-sm">{t("costs.billed.l")}</div>
        </div>
        <div>
          <div className="text-2xl font-extrabold tracking-tight text-brand-bright sm:text-3xl">
            {formatUsd(estimated)}
          </div>
          <div className="muted mt-1 text-sm">{t("costs.estimated.l")}</div>
        </div>
        {billed > 0 ? (
          <span className="badge badge-neutral">
            {drift >= 0 ? "+" : ""}
            {drift.toFixed(1)}% {t("costs.drift")}
          </span>
        ) : null}
      </div>
      <p className="muted max-w-sm text-xs leading-relaxed">
        {billed > 0 ? t("costs.recon") : t("costs.billed.hint")}
      </p>
    </div>
  );
}

function TrendBars({ daily }: { daily: Daily[] }) {
  const max = Math.max(...daily.map((d) => d.cost_usd), 0.000001);
  return (
    <div className="mt-5 flex h-32 items-end gap-1.5">
      {daily.map((d) => (
        <div key={d.date} className="group flex flex-1 flex-col items-center justify-end gap-1.5">
          <div className="text-[10px] font-medium text-white/0 transition group-hover:text-white/70">
            {formatUsd(d.cost_usd)}
          </div>
          <div
            className="w-full rounded-t bg-brand/60 transition group-hover:bg-brand"
            style={{ height: `${Math.max((d.cost_usd / max) * 100, 2)}%` }}
            title={`${d.date} · ${formatUsd(d.cost_usd)}`}
          />
          <div className="text-[9px] text-white/35">{d.date.slice(5)}</div>
        </div>
      ))}
    </div>
  );
}

function BucketCard({
  title,
  rows,
  label,
  t,
}: {
  title: string;
  rows: Bucket[];
  label: (key: string) => string;
  t: (k: StrKey) => string;
}) {
  const max = Math.max(...rows.map((r) => r.cost_usd), 0.000001);
  return (
    <div className="card flex flex-col p-5">
      <h2 className="font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="muted mt-3 text-sm">—</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium">{label(r.key)}</span>
                <span className="shrink-0 font-semibold text-brand-bright">
                  {formatUsd(r.cost_usd)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-pill bg-white/5">
                <div
                  className="h-full rounded-pill bg-brand/60"
                  style={{ width: `${Math.max((r.cost_usd / max) * 100, 2)}%` }}
                />
              </div>
              <div className="muted mt-1 text-xs">
                {formatTokens(r.tokens)} {t("costs.col.tokens").toLowerCase()} · {r.calls}{" "}
                {t("costs.col.calls").toLowerCase()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
