"use client";

import { useEffect, useState } from "react";

import { ShieldMark } from "@/components/brand";
import { Spinner } from "@/components/Spinner";
import { apiGet } from "@/lib/client";
import { type StrKey, useT } from "@/lib/i18n";

interface AuditEntry {
  decision: string | null;
}

function bucket(decision: string | null): "allow" | "review" | "block" {
  const d = (decision ?? "").toLowerCase();
  if (d === "deny" || d === "hitl_denied") return "block";
  if (d.startsWith("hitl") || d === "expired" || d === "hold") return "review";
  return "allow";
}

const MEANS: { t: StrKey; b: StrKey }[] = [
  { t: "exec.means.1.t", b: "exec.means.1.b" },
  { t: "exec.means.2.t", b: "exec.means.2.b" },
  { t: "exec.means.3.t", b: "exec.means.3.b" },
];

export default function ExecutivePage() {
  const { t } = useT();
  const [loading, setLoading] = useState(true);
  const [governed, setGoverned] = useState(0);
  const [counts, setCounts] = useState({ allow: 0, review: 0, block: 0 });

  useEffect(() => {
    Promise.allSettled([apiGet<unknown[]>("v1/tools"), apiGet<AuditEntry[]>("v1/audit")])
      .then(([tools, audit]) => {
        setGoverned(tools.status === "fulfilled" ? tools.value.length : 0);
        const c = { allow: 0, review: 0, block: 0 };
        if (audit.status === "fulfilled") for (const e of audit.value) c[bucket(e.decision)] += 1;
        setCounts(c);
      })
      .finally(() => setLoading(false));
  }, []);

  const total = counts.allow + counts.review + counts.block;
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : "0%");

  const KPIS: { value: string | number; label: StrKey; sub: StrKey; tone: string }[] = [
    { value: governed, label: "exec.kpi.governed.l", sub: "exec.kpi.governed.s", tone: "text-brand-bright" },
    { value: counts.review, label: "exec.kpi.review.l", sub: "exec.kpi.review.s", tone: "text-amber-300" },
    { value: counts.block, label: "exec.kpi.blocked.l", sub: "exec.kpi.blocked.s", tone: "text-red-300" },
    { value: "100%", label: "exec.kpi.coverage.l", sub: "exec.kpi.coverage.s", tone: "text-emerald-300" },
  ];

  return (
    <section className="flex animate-fade-up flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">{t("exec.title")}</h1>
        <p className="muted mt-1.5 max-w-2xl">{t("exec.subtitle")}</p>
      </header>

      {loading ? (
        <div className="card">
          <Spinner label={t("common.loading")} slowLabel={t("common.waking")} />
        </div>
      ) : (
        <>
          {/* Headline KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {KPIS.map((k) => (
              <div key={k.label} className="card p-6">
                <div className={`text-4xl font-extrabold tracking-tight ${k.tone}`}>{k.value}</div>
                <div className="mt-2 font-semibold">{t(k.label)}</div>
                <div className="muted mt-1 text-sm leading-snug">{t(k.sub)}</div>
              </div>
            ))}
          </div>

          {/* What happened to the actions */}
          <div className="card p-6">
            <h2 className="font-semibold">{t("exec.chart.title")}</h2>
            {total === 0 ? (
              <p className="muted mt-3 text-sm">{t("exec.chart.empty")}</p>
            ) : (
              <>
                <div className="mt-4 flex h-4 w-full overflow-hidden rounded-pill bg-white/5">
                  <div className="bg-emerald-400/70" style={{ width: pct(counts.allow) }} />
                  <div className="bg-amber-400/70" style={{ width: pct(counts.review) }} />
                  <div className="bg-red-400/70" style={{ width: pct(counts.block) }} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                    <span className="muted">{t("exec.chart.allow")}</span>
                    <span className="ml-auto font-semibold text-white">{counts.allow}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                    <span className="muted">{t("exec.chart.review")}</span>
                    <span className="ml-auto font-semibold text-white">{counts.review}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
                    <span className="muted">{t("exec.chart.block")}</span>
                    <span className="ml-auto font-semibold text-white">{counts.block}</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* What this means for you */}
          <div>
            <h2 className="text-xl font-bold">{t("exec.means.title")}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {MEANS.map((m, i) => (
                <div key={m.t} className="card p-5">
                  <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-brand/15 text-sm font-bold text-brand-bright ring-1 ring-brand/30">
                    {i + 1}
                  </div>
                  <h3 className="font-semibold">{t(m.t)}</h3>
                  <p className="muted mt-1.5 text-sm leading-relaxed">{t(m.b)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Compliance band */}
          <div className="flex items-start gap-4 rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/15 to-transparent p-6">
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/20 text-brand-bright ring-1 ring-brand/40">
              <ShieldMark className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">{t("exec.comp.title")}</h2>
              <p className="muted mt-1.5 max-w-2xl text-sm leading-relaxed">{t("exec.comp.body")}</p>
            </div>
          </div>

          {/* Bottom line */}
          <p className="text-center text-lg font-semibold text-white/90">{t("exec.bottom")}</p>
        </>
      )}
    </section>
  );
}
