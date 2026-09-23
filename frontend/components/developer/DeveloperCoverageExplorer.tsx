"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DEVELOPER_GUARD_COVERAGE, type DeveloperGuardMode } from "@/lib/product-coverage";
import { THREAT_GLOSSARY } from "@/lib/threat-glossary";
import { useT } from "@/lib/i18n";
import { DEVELOPER_COPY } from "./developer-copy";

const MODES: readonly DeveloperGuardMode[] = ["B", "D", "O", "A", "X"];

function options(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function DeveloperCoverageExplorer() {
  const { lang } = useT();
  const copy = DEVELOPER_COPY[lang].security;
  const [mode, setMode] = useState<DeveloperGuardMode | "all">("all");
  const [module, setModule] = useState("all");
  const [assistant, setAssistant] = useState("all");
  const [environment, setEnvironment] = useState("all");
  const [visibleCount, setVisibleCount] = useState(8);
  const threats = DEVELOPER_GUARD_COVERAGE.threats;
  const labels = useMemo(() => new Map(THREAT_GLOSSARY.map((entry) => [entry.id, entry.copy[lang].title])), [lang]);
  const modules = options(threats.map((entry) => entry.module));
  const assistants = options(threats.flatMap((entry) => entry.hosts.map((host) => host.assistant)));
  const environments = options(threats.flatMap((entry) => [entry.environment, ...entry.hosts.map((host) => host.environment)]));
  const entries = threats.filter((entry) =>
    (mode === "all" || entry.mode === mode) &&
    (module === "all" || entry.module === module) &&
    (assistant === "all" || entry.hosts.some((host) => host.assistant === assistant)) &&
    (environment === "all" || entry.environment === environment || entry.hosts.some((host) => host.environment === environment)),
  );
  const visibleEntries = entries.slice(0, visibleCount);
  const all = lang === "fr" ? "Tous" : "All";
  const labelsUi = lang === "fr"
    ? { mode: "Mode de preuve", module: "Module", assistant: "Assistant", environment: "Environnement", found: "menaces affichées", empty: "Aucune ligne ne correspond à ces filtres.", reset: "Réinitialiser", conditions: "Préconditions", limit: "Limite", proof: "Scénarios de preuve", status: "État", link: "Voir la menace" }
    : { mode: "Evidence mode", module: "Module", assistant: "Assistant", environment: "Environment", found: "threats shown", empty: "No record matches these filters.", reset: "Reset", conditions: "Preconditions", limit: "Limit", proof: "Evidence scenarios", status: "Status", link: "View threat" };
  const more = lang === "fr" ? "Afficher 8 lignes supplémentaires" : "Show 8 more records";

  useEffect(() => setVisibleCount(8), [mode, module, assistant, environment]);

  const reset = () => { setMode("all"); setModule("all"); setAssistant("all"); setEnvironment("all"); };

  return (
    <div className="developer-coverage" data-testid="developer-coverage">
      <div className="developer-coverage__filters">
        <CoverageSelect label={labelsUi.mode} value={mode} onChange={(value) => setMode(value as DeveloperGuardMode | "all")}>
          <option value="all">{all}</option>
          {MODES.map((id) => <option value={id} key={id}>{id} · {copy.modes[id][0]}</option>)}
        </CoverageSelect>
        <CoverageSelect label={labelsUi.module} value={module} onChange={setModule}>
          <option value="all">{all}</option>{modules.map((value) => <option key={value}>{value}</option>)}
        </CoverageSelect>
        <CoverageSelect label={labelsUi.assistant} value={assistant} onChange={setAssistant}>
          <option value="all">{all}</option>{assistants.map((value) => <option key={value}>{value}</option>)}
        </CoverageSelect>
        <CoverageSelect label={labelsUi.environment} value={environment} onChange={setEnvironment}>
          <option value="all">{all}</option>{environments.map((value) => <option key={value}>{value}</option>)}
        </CoverageSelect>
      </div>
      <div className="developer-coverage__status">
        <p role="status"><strong>{entries.length}</strong> / {threats.length} {labelsUi.found}</p>
        {(mode !== "all" || module !== "all" || assistant !== "all" || environment !== "all") && <button type="button" onClick={reset}>{labelsUi.reset}</button>}
      </div>
      {entries.length === 0 ? <p className="developer-empty">{labelsUi.empty}</p> : (
        <div className="developer-coverage__list">
          {visibleEntries.map((entry) => (
            <article key={entry.id} className="developer-coverage__entry">
              <header>
                <div><span className="developer-mode" data-mode={entry.mode}>{entry.mode}</span><h3>{labels.get(entry.id) ?? entry.id}</h3></div>
                <span>{labelsUi.status} · {entry.status === "implemented_local" ? (lang === "fr" ? "implémenté localement" : "implemented locally") : (lang === "fr" ? "hors périmètre" : "out of scope")}</span>
              </header>
              <p className="developer-coverage__module">{entry.module} · {entry.environment}</p>
              {entry.hosts.length > 0 && <ul className="developer-tags">{entry.hosts.map((host) => <li key={`${host.assistant}-${host.environment}`}>{host.assistant} · {host.environment}{host.verified === false ? (lang === "fr" ? " · non vérifié" : " · unverified") : ""}</li>)}</ul>}
              <dl>
                <div><dt>{labelsUi.conditions}</dt><dd>{entry.preconditions.length ? entry.preconditions.join(" · ") : "—"}</dd></div>
                <div><dt>{labelsUi.proof}</dt><dd>{entry.scenarios.length ? entry.scenarios.join(" · ") : "—"}</dd></div>
                <div><dt>{labelsUi.limit}</dt><dd>{entry.limit}</dd></div>
              </dl>
              <Link href={`/menaces#${entry.id}`}>{labelsUi.link} ↗</Link>
            </article>
          ))}
        </div>
      )}
      {visibleCount < entries.length && <button className="developer-coverage__more" type="button" onClick={() => setVisibleCount((current) => current + 8)}>{more} <span aria-hidden="true">↓</span></button>}
    </div>
  );
}

function CoverageSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}
