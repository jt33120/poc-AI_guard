"use client";

import { useT } from "@/lib/i18n";
import { DeveloperCoverageExplorer } from "./DeveloperCoverageExplorer";
import { DeveloperPublicShell } from "./DeveloperPublicShell";
import { DEVELOPER_COPY } from "./developer-copy";

export function DeveloperSecurity() {
  const { lang } = useT();
  const copy = DEVELOPER_COPY[lang].security;
  const modes = Object.entries(copy.modes) as [keyof typeof copy.modes, readonly [string, string]][];
  return (
    <DeveloperPublicShell current="security">
      <main>
        <section className="developer-page-hero guard-wrap" aria-labelledby="security-heading">
          <p className="guard-kicker">{copy.kicker}</p><h1 id="security-heading">{copy.title}</h1><p>{copy.intro}</p>
        </section>
        <section className="developer-section guard-wrap" aria-labelledby="flow-heading">
          <header className="developer-section__heading"><p>01 / DATA FLOW</p><h2 id="flow-heading">{copy.flowTitle}</h2></header>
          <ol className="developer-flow">{copy.flow.map((step) => <li key={step.marker}><span>{step.marker}</span><h3>{step.title}</h3><p>{step.body}</p></li>)}</ol>
        </section>
        <section className="developer-section developer-section--tint" aria-labelledby="evidence-modes-heading"><div className="guard-wrap">
          <header className="developer-section__heading"><p>02 / EVIDENCE LANGUAGE</p><h2 id="evidence-modes-heading">{copy.evidenceTitle}</h2></header>
          <div className="developer-modes">{modes.map(([mode, value]) => <article key={mode}><span className="developer-mode" data-mode={mode}>{mode}</span><h3>{value[0]}</h3><p>{value[1]}</p></article>)}</div>
        </div></section>
        <section className="developer-section guard-wrap developer-conditions" aria-label={lang === "fr" ? "Préconditions et limites" : "Preconditions and limits"}>
          <article><h2>{copy.requirementsTitle}</h2><ul>{copy.requirements.map((item) => <li key={item}>{item}</li>)}</ul></article>
          <article><h2>{copy.limitsTitle}</h2><ul>{copy.limits.map((item) => <li key={item}>{item}</li>)}</ul></article>
        </section>
        <section className="developer-section developer-section--coverage guard-wrap" aria-labelledby="coverage-heading">
          <header className="developer-section__heading"><p>GENERATED COVERAGE / REGISTRY</p><h2 id="coverage-heading">{copy.explorerTitle}</h2><p>{copy.explorerIntro}</p></header>
          <DeveloperCoverageExplorer />
        </section>
      </main>
    </DeveloperPublicShell>
  );
}
