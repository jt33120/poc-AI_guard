"use client";

import { useEffect, useState } from "react";

import { ClientScopeBar, clientSuffix, useClientScope } from "@/components/ClientScope";
import { type ExecCounts, ExecutiveSummary } from "@/components/ExecutiveSummary";
import { Spinner } from "@/components/Spinner";
import { apiGet } from "@/lib/client";
import { useT } from "@/lib/i18n";

interface AuditEntry {
  decision: string | null;
}
interface UsageSummary {
  total_cost_usd: number;
}

function bucket(decision: string | null): keyof ExecCounts {
  const d = (decision ?? "").toLowerCase();
  if (d === "deny" || d === "hitl_denied") return "block";
  if (d.startsWith("hitl") || d === "expired" || d === "hold") return "review";
  return "allow";
}

export default function ExecutivePage() {
  const { t } = useT();
  const { selected } = useClientScope();
  const [loading, setLoading] = useState(true);
  const [governed, setGoverned] = useState(0);
  const [counts, setCounts] = useState<ExecCounts>({ allow: 0, review: 0, block: 0 });
  const [spend, setSpend] = useState(0);

  useEffect(() => {
    const suffix = clientSuffix(selected);
    setLoading(true);
    Promise.allSettled([
      apiGet<unknown[]>("v1/tools"),
      apiGet<AuditEntry[]>(`v1/audit${suffix}`),
      apiGet<UsageSummary>(`v1/usage${suffix}`),
    ])
      .then(([tools, audit, usage]) => {
        setGoverned(tools.status === "fulfilled" ? tools.value.length : 0);
        const c: ExecCounts = { allow: 0, review: 0, block: 0 };
        if (audit.status === "fulfilled") for (const e of audit.value) c[bucket(e.decision)] += 1;
        setCounts(c);
        setSpend(usage.status === "fulfilled" ? usage.value.total_cost_usd : 0);
      })
      .finally(() => setLoading(false));
  }, [selected]);

  return (
    <section className="flex animate-fade-up flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">{t("exec.title")}</h1>
        <p className="muted mt-1.5 max-w-2xl">{t("exec.subtitle")}</p>
      </header>
      <ClientScopeBar />
      {loading ? (
        <div className="card">
          <Spinner label={t("common.loading")} slowLabel={t("common.waking")} />
        </div>
      ) : (
        <ExecutiveSummary governed={governed} counts={counts} spendUsd={spend} />
      )}
    </section>
  );
}
