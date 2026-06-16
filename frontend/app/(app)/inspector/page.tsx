"use client";

import { useEffect, useState } from "react";

import { Spinner } from "@/components/Spinner";
import { Tooltip } from "@/components/Tooltip";
import { apiGet } from "@/lib/client";
import { type StrKey, useT } from "@/lib/i18n";

interface ToolView {
  name: string;
  canonical: string;
  action_class: string | null;
  decision: string;
}

const CLASS_KEY: Record<string, StrKey> = {
  read: "class.read",
  write: "class.write",
  external_send: "class.external_send",
  irreversible: "class.irreversible",
};

const DECISION: Record<string, { cls: string; label: StrKey; desc: StrKey }> = {
  auto: { cls: "badge-green", label: "decl.auto", desc: "dec.auto" },
  human_in_the_loop: { cls: "badge-amber", label: "decl.human_in_the_loop", desc: "dec.human_in_the_loop" },
  human_dual: { cls: "badge-amber", label: "decl.human_dual", desc: "dec.human_dual" },
  deny: { cls: "badge-red", label: "decl.deny", desc: "dec.deny" },
};

export default function InspectorPage() {
  const { t } = useT();
  const [tools, setTools] = useState<ToolView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<ToolView[]>("v1/tools")
      .then(setTools)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="flex animate-fade-up flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold">{t("inspector.title")}</h1>
        <p className="muted mt-1">{t("inspector.subtitle")}</p>
      </header>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("inspector.col.tool")}</th>
              <th>{t("inspector.col.class")}</th>
              <th>{t("inspector.col.decision")}</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => {
              const ck = tool.action_class ? CLASS_KEY[tool.action_class] : undefined;
              const dec = DECISION[tool.decision];
              return (
                <tr key={tool.canonical}>
                  <td className="font-mono text-white">{tool.name}</td>
                  <td>
                    {ck ? (
                      <Tooltip label={t(`${ck}.desc` as StrKey)}>
                        <span className="badge badge-neutral">{t(ck)}</span>
                      </Tooltip>
                    ) : tool.action_class ? (
                      <span className="badge badge-neutral">{tool.action_class}</span>
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
                  </td>
                  <td>
                    {dec ? (
                      <Tooltip label={t(dec.desc)}>
                        <span className={`badge ${dec.cls}`}>{t(dec.label)}</span>
                      </Tooltip>
                    ) : (
                      <span className="badge badge-neutral">{tool.decision}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading ? (
          <Spinner label={t("common.loading")} slowLabel={t("common.waking")} />
        ) : tools.length === 0 && !error ? (
          <p className="muted p-4">{t("inspector.empty")}</p>
        ) : null}
      </div>
    </section>
  );
}
