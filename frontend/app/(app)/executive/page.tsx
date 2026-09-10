"use client";

import { useEffect, useState } from "react";

import {
  ClientScopeBar,
  clientSuffix,
  useClientScope,
} from "@/components/ClientScope";
import {
  type ExecCounts,
  ExecutiveSummary,
} from "@/components/ExecutiveSummary";
import { Spinner } from "@/components/Spinner";
import { ConsoleError, ConsoleHeader } from "@/components/ConsoleUI";
import { apiGet } from "@/lib/client";
import { summarizeDecisions } from "@/lib/executive-counts";
import { useT } from "@/lib/i18n";

interface AuditEntry {
  decision: string | null;
}
interface UsageSummary {
  total_cost_usd: number;
}

export default function ExecutivePage() {
  const { t, lang } = useT();
  const { selected } = useClientScope();
  const [loading, setLoading] = useState(true);
  const [governed, setGoverned] = useState(0);
  const [counts, setCounts] = useState<ExecCounts>({
    allow: 0,
    review: 0,
    block: 0,
  });
  const [spend, setSpend] = useState(0);
  const [otherEvents, setOtherEvents] = useState(0);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const suffix = clientSuffix(selected);
    setLoading(true);
    setError(null);
    Promise.allSettled([
      apiGet<unknown[]>("v1/tools"),
      apiGet<AuditEntry[]>(`v1/audit${suffix}`),
      apiGet<UsageSummary>(`v1/usage${suffix}`),
    ])
      .then(([tools, audit, usage]) => {
        const failed = [tools, audit, usage].find(
          (result) => result.status === "rejected",
        );
        if (failed?.status === "rejected") {
          setError(failed.reason);
          return;
        }
        setGoverned(tools.status === "fulfilled" ? tools.value.length : 0);
        const summary = summarizeDecisions(
          audit.status === "fulfilled" ? audit.value : [],
        );
        setCounts(summary.counts);
        setOtherEvents(summary.other);
        setSpend(usage.status === "fulfilled" ? usage.value.total_cost_usd : 0);
      })
      .finally(() => setLoading(false));
  }, [selected]);

  return (
    <section className="console-page">
      <ConsoleHeader
        eyebrow="07 / EXECUTIVE"
        title={t("exec.title")}
        description={
          lang === "fr"
            ? "Registre, décisions journalisées et coût déclaré. Les limites de visibilité restent explicites."
            : "Registry, recorded decisions and reported cost. Visibility limits remain explicit."
        }
      />
      <ClientScopeBar />
      {loading ? (
        <div className="card">
          <Spinner label={t("common.loading")} slowLabel={t("common.waking")} />
        </div>
      ) : error != null ? (
        <ConsoleError error={error} />
      ) : (
        <ExecutiveSummary
          governed={governed}
          counts={counts}
          spendUsd={spend}
          otherEvents={otherEvents}
          operational
        />
      )}
    </section>
  );
}
