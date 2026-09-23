"use client";

import Link from "next/link";

import { useT } from "@/lib/i18n";
import { GuardOffers, GuardPublisher } from "@/components/GuardOffers";
import { DeveloperPublicShell } from "./DeveloperPublicShell";
import { DeveloperScenario } from "./DeveloperScenario";
import { DEVELOPER_COPY } from "./developer-copy";

export function DeveloperLanding() {
  const { lang } = useT();
  const copy = DEVELOPER_COPY[lang].landing;
  return (
    <DeveloperPublicShell current="overview">
      <main>
        <section className="developer-hero guard-wrap" aria-labelledby="developer-heading">
          <div className="developer-hero__copy reveal">
            <p className="guard-kicker">{copy.kicker}</p>
            <h1 id="developer-heading">{copy.title}</h1>
            <p className="developer-lead">{copy.intro}</p>
            <p className="developer-availability">{copy.availability}</p>
            <div className="developer-actions">
              <Link className="guard-button" href="/developpeurs/tarifs">{copy.primary} ↗</Link>
              <Link href="#scenario-heading">{copy.secondary} →</Link>
            </div>
          </div>
          <aside className="developer-proof-rail" aria-label={lang === "fr" ? "Promesse bornée" : "Bounded claim"}>
            <span>XSOM CONSULTING · FRANCE</span>
            <p>{copy.promise}</p>
            <dl>
              <div><dt>{lang === "fr" ? "Local" : "Local"}</dt><dd>{lang === "fr" ? "Détection sur le poste" : "On-device detection"}</dd></div>
              <div><dt>90</dt><dd>{lang === "fr" ? "jours pour évaluer en équipe" : "days to evaluate as a team"}</dd></div>
              <div><dt>xSOM</dt><dd>{lang === "fr" ? "Éditeur et interlocuteur" : "Publisher and contact"}</dd></div>
            </dl>
          </aside>
        </section>

        <GuardOffers />
        <GuardPublisher />
        <section className="developer-section guard-wrap" aria-labelledby="levels-heading">
          <header className="developer-section__heading"><p>01 / CONTROL LEVELS</p><h2 id="levels-heading">{copy.controlsTitle}</h2><p>{copy.controlsIntro}</p></header>
          <div className="developer-levels">
            {copy.levels.map((level) => <article key={level.id}><span>{level.marker}</span><p className="developer-status">{level.status}</p><h3>{level.title}</h3><p>{level.body}</p><p className="developer-limit"><strong>{lang === "fr" ? "Limite" : "Limit"}</strong>{level.limit}</p></article>)}
          </div>
        </section>

        <section className="developer-section developer-section--tint" aria-labelledby="scenario-heading">
          <div className="guard-wrap">
            <header className="developer-section__heading"><p>02 / GUIDED SCENARIO</p><h2 id="scenario-heading">{copy.scenarioTitle}</h2><p>{copy.scenarioIntro}</p></header>
            <DeveloperScenario />
          </div>
        </section>

        <section className="developer-section guard-wrap" aria-labelledby="compatibility-heading">
          <header className="developer-section__heading"><p>03 / HOST MATRIX</p><h2 id="compatibility-heading">{copy.compatibilityTitle}</h2><p>{copy.compatibilityIntro}</p></header>
          <div className="developer-hosts">{copy.hosts.map((host) => <article key={host.name}><h3>{host.name}</h3><p className="developer-status">{host.status}</p><p>{host.detail}</p></article>)}</div>
        </section>

        <section className="developer-section developer-cta guard-wrap" aria-labelledby="pilot-heading">
          <div><p>04 / PILOT</p><h2 id="pilot-heading">{copy.ctaTitle}</h2><p>{copy.ctaBody}</p></div>
          <Link href="/developpeurs/tarifs" className="guard-button">{copy.primary} ↗</Link>
        </section>
      </main>
    </DeveloperPublicShell>
  );
}
