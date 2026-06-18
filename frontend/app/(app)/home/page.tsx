"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ClientScopeBar, clientSuffix, useClientScope } from "@/components/ClientScope";
import { Spinner } from "@/components/Spinner";
import { apiGet } from "@/lib/client";
import { type StrKey, useT } from "@/lib/i18n";

interface ToolView {
  decision: string;
}
interface AuditEntry {
  decision: string | null;
}

const GATED = new Set(["human_in_the_loop", "human_dual", "deny"]);

function bucket(decision: string | null): "allow" | "hitl" | "deny" {
  const d = (decision ?? "").toLowerCase();
  if (d === "deny" || d === "hitl_denied") return "deny";
  if (d.startsWith("hitl") || d === "expired" || d === "hold") return "hitl";
  return "allow";
}

const STEPS: [StrKey, StrKey][] = [
  ["home.start.s1.t", "home.start.s1.b"],
  ["home.start.s2.t", "home.start.s2.b"],
  ["home.start.s3.t", "home.start.s3.b"],
  ["home.start.s4.t", "home.start.s4.b"],
  ["home.start.s5.t", "home.start.s5.b"],
];

const PAGES: { href: string; title: StrKey; body: StrKey }[] = [
  { href: "/inspector", title: "nav.inspector", body: "home.pages.inspector.b" },
  { href: "/approvals", title: "nav.approvals", body: "home.pages.approvals.b" },
  { href: "/audit", title: "nav.audit", body: "home.pages.audit.b" },
  { href: "/admin", title: "nav.admin", body: "home.pages.admin.b" },
];

const TECH_KW = ["MCP gateway", "Policy engine", "Hash-chained audit", "LLM judge", "Multi-tenant RLS"];

export default function HomePage() {
  const { t } = useT();
  const { selected } = useClientScope();
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState({ actions: 0, pending: 0, gated: 0, audit: 0 });
  const [chart, setChart] = useState({ allow: 0, hitl: 0, deny: 0 });

  useEffect(() => {
    const auditPath = `v1/audit${clientSuffix(selected)}`;
    setLoading(true);
    Promise.allSettled([
      apiGet<ToolView[]>("v1/tools"),
      apiGet<unknown[]>("v1/approvals?status=pending"),
      apiGet<AuditEntry[]>(auditPath),
    ])
      .then(([tools, approvals, audit]) => {
        const toolList = tools.status === "fulfilled" ? tools.value : [];
        const pending = approvals.status === "fulfilled" ? approvals.value.length : 0;
        const auditList = audit.status === "fulfilled" ? audit.value : [];
        const counts = { allow: 0, hitl: 0, deny: 0 };
        for (const e of auditList) counts[bucket(e.decision)] += 1;
        setKpi({
          actions: toolList.length,
          pending,
          gated: toolList.filter((x) => GATED.has(x.decision)).length,
          audit: auditList.length,
        });
        setChart(counts);
      })
      .finally(() => setLoading(false));
  }, [selected]);

  const total = chart.allow + chart.hitl + chart.deny;
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : "0%");

  const KPIS: { label: StrKey; value: number }[] = [
    { label: "home.kpi.actions", value: kpi.actions },
    { label: "home.kpi.pending", value: kpi.pending },
    { label: "home.kpi.gated", value: kpi.gated },
    { label: "home.kpi.audit", value: kpi.audit },
  ];

  return (
    <section className="flex animate-fade-up flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">{t("home.title")}</h1>
        <p className="muted mt-1.5">{t("home.subtitle")}</p>
      </header>

      <ClientScopeBar />

      {loading ? (
        <div className="card">
          <Spinner label={t("common.loading")} slowLabel={t("common.waking")} />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {KPIS.map((k) => (
              <div key={k.label} className="card p-5">
                <div className="text-3xl font-extrabold tracking-tight text-brand-bright">
                  {k.value}
                </div>
                <div className="muted mt-1.5 text-sm leading-snug">{t(k.label)}</div>
              </div>
            ))}
          </div>

          {/* Decision breakdown */}
          <div className="card p-6">
            <h2 className="font-semibold">{t("home.chart.title")}</h2>
            {total === 0 ? (
              <p className="muted mt-3 text-sm">{t("home.chart.empty")}</p>
            ) : (
              <>
                <div className="mt-4 flex h-3 w-full overflow-hidden rounded-pill bg-white/5">
                  <div className="bg-emerald-400/70" style={{ width: pct(chart.allow) }} />
                  <div className="bg-amber-400/70" style={{ width: pct(chart.hitl) }} />
                  <div className="bg-red-400/70" style={{ width: pct(chart.deny) }} />
                </div>
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                    {t("home.chart.allow")} <span className="font-semibold text-white">{chart.allow}</span>
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                    {t("home.chart.hitl")} <span className="font-semibold text-white">{chart.hitl}</span>
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
                    {t("home.chart.deny")} <span className="font-semibold text-white">{chart.deny}</span>
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Getting started */}
          <div>
            <span className="label text-brand-bright">{t("home.start.kicker")}</span>
            <h2 className="mt-1.5 text-xl font-bold">{t("home.start.title")}</h2>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {STEPS.map(([title, body], i) => (
                <li key={title} className="card flex gap-3 p-5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand/15 text-sm font-bold text-brand-bright ring-1 ring-brand/30">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold">{t(title)}</h3>
                    <p className="muted mt-1 text-sm leading-relaxed">{t(body)}</p>
                    {i === 0 ? (
                      <Link
                        href="/onboarding"
                        className="mt-2 inline-flex text-sm font-semibold text-brand-bright hover:underline"
                      >
                        {t("nav.onboard")} →
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* What each page is for */}
          <div>
            <span className="label text-brand-bright">{t("home.pages.kicker")}</span>
            <h2 className="mt-1.5 text-xl font-bold">{t("home.pages.title")}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {PAGES.map((p) => (
                <div key={p.href} className="card flex flex-col p-5">
                  <h3 className="font-semibold">{t(p.title)}</h3>
                  <p className="muted mt-1.5 grow text-sm leading-relaxed">{t(p.body)}</p>
                  <Link
                    href={p.href}
                    className="mt-3 inline-flex w-fit text-sm font-semibold text-brand-bright hover:underline"
                  >
                    {t("home.pages.open")} →
                  </Link>
                </div>
              ))}
            </div>
            {/* Badge legend */}
            <div className="card mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
              <span className="label">{t("home.legend.title")}</span>
              <span className="badge badge-green">{t("home.legend.green")}</span>
              <span className="badge badge-amber">{t("home.legend.amber")}</span>
              <span className="badge badge-red">{t("home.legend.red")}</span>
            </div>
          </div>

          {/* Under the hood */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <h2 className="font-semibold">{t("home.tech.title")}</h2>
            <p className="muted mt-1.5 max-w-3xl text-sm leading-relaxed">{t("home.tech.body")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {TECH_KW.map((kw) => (
                <span key={kw} className="badge badge-neutral">
                  {kw}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
