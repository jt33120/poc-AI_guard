"use client";

import { useEffect, useState } from "react";

import { ClientScopeBar, clientSuffix, useClientScope } from "@/components/ClientScope";
import { DecisionBadge } from "@/components/brand";
import { Spinner } from "@/components/Spinner";
import { Tooltip } from "@/components/Tooltip";
import { apiGet, exportUrl } from "@/lib/client";
import { type StrKey, useT } from "@/lib/i18n";

interface AuditEntry {
  id: number;
  ts: string | null;
  tool_name: string | null;
  action_class: string | null;
  decision: string | null;
  args_hash: string | null;
  gateway_token_id: string | null;
  error: string | null;
}

// Egress DLP events are audited as "<provider>.egress" with the detected kinds
// carried in `error` as "dlp:aws_access_key_id,email" — never the value.
const isEgress = (e: AuditEntry) => !!e.tool_name?.endsWith(".egress");
const dlpKinds = (e: AuditEntry): string =>
  e.error?.startsWith("dlp:") ? e.error.slice(4).split(",").join(", ") : "";

const CLASS_KEY: Record<string, StrKey> = {
  read: "class.read",
  write: "class.write",
  external_send: "class.external_send",
  irreversible: "class.irreversible",
};

export default function AuditPage() {
  const { t } = useT();
  const { selected, agents } = useClientScope();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const path = `v1/audit${clientSuffix(selected)}`;
    setLoading(true);
    apiGet<AuditEntry[]>(path)
      .then(setEntries)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selected]);

  const agentName = (id: string | null) =>
    id ? (agents.find((a) => a.id === id)?.name ?? `${id.slice(0, 8)}…`) : "—";

  return (
    <section className="flex animate-fade-up flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("audit.title")}</h1>
          <p className="muted mt-1">{t("audit.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <a className="btn btn-ghost px-4 py-1.5" href={exportUrl("ai_act", "pdf")}>
            {t("audit.export.aiact")}
          </a>
          <a className="btn btn-ghost px-4 py-1.5" href={exportUrl("rgpd", "json")}>
            {t("audit.export.gdpr")}
          </a>
        </div>
      </header>
      <ClientScopeBar />
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t("audit.col.tool")}</th>
              <th>{t("scope.view")}</th>
              <th>{t("audit.col.class")}</th>
              <th>{t("audit.col.decision")}</th>
              <th>args_hash</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const ck = entry.action_class ? CLASS_KEY[entry.action_class] : undefined;
              return (
                <tr key={entry.id}>
                  <td className="text-white/45">{entry.id}</td>
                  <td className="font-mono">
                    {isEgress(entry) ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="badge badge-amber">{t("dlp.egress")}</span>
                        <span>{entry.tool_name}</span>
                      </span>
                    ) : (
                      (entry.tool_name ?? "—")
                    )}
                  </td>
                  <td className="text-white/60">{agentName(entry.gateway_token_id)}</td>
                  <td>
                    {ck ? (
                      <Tooltip label={t(`${ck}.desc` as StrKey)}>
                        <span className="text-white/70">{t(ck)}</span>
                      </Tooltip>
                    ) : (
                      (entry.action_class ?? "—")
                    )}
                  </td>
                  <td>
                    <DecisionBadge value={entry.decision} />
                  </td>
                  <td className="font-mono text-xs text-white/35">
                    {isEgress(entry) && dlpKinds(entry) ? (
                      <span className="text-amber-200/80">{dlpKinds(entry)}</span>
                    ) : entry.args_hash ? (
                      entry.args_hash.slice(0, 12)
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading ? (
          <Spinner label={t("common.loading")} slowLabel={t("common.waking")} />
        ) : entries.length === 0 && !error ? (
          <p className="muted p-4">{t("audit.empty")}</p>
        ) : null}
      </div>
    </section>
  );
}
