"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { GUARD_UNIVERSES, type GuardHomeCopy, type GuardUniverse } from "./guard-home-copy";

/** Local explanatory state only: selecting a room never configures a service. */
export function GuardCampus({ copy }: { copy: GuardHomeCopy }) {
  const [universe, setUniverse] = useState<GuardUniverse>("development");
  const [risks, setRisks] = useState(false);
  const selected = copy.universes[universe];

  return (
    <section id="usages" className="guard-home-section guard-wrap" aria-labelledby="usages-heading">
      <div className="guard-home-heading">
        <p className="guard-kicker">{copy.usagesKicker}</p>
        <h2 id="usages-heading">{copy.usagesTitle}</h2>
        <p>{copy.usagesIntro}</p>
      </div>
      <div className="guard-campus" data-risks={risks} data-universe={universe}>
        <div className="guard-campus__toolbar">
          <div><strong>{copy.sceneTitle}</strong><span>{copy.sceneNote}</span></div>
          <button type="button" className="guard-risk-switch" role="switch" aria-checked={risks} aria-controls="campus-view campus-detail" onClick={() => setRisks(!risks)}>
            <span>{copy.toggle}</span><span className="guard-risk-switch__track" aria-hidden="true"><span /></span>
          </button>
        </div>
        <div className="guard-campus__view" id="campus-view">
          <Image src="/signal-media/ai-guard-campus-v2.png" alt={copy.imageAlt} width={1536} height={1024} sizes="(max-width: 1280px) 100vw, 1200px" className="guard-campus__image" />
          <div className="guard-campus__annotations">
            {GUARD_UNIVERSES.map((id) => (
              <div className={`guard-campus__annotation guard-campus__annotation--${id}`} key={id} data-selected={id === universe}>
                {risks && <span className="guard-campus__risk-label" aria-hidden="true"><span>!</span>{copy.universes[id].riskLabel}</span>}
                <button type="button" className="guard-campus__pin" aria-label={copy.universes[id].name} aria-pressed={id === universe} aria-controls="campus-detail" onClick={() => setUniverse(id)}>{copy.universes[id].marker}</button>
              </div>
            ))}
          </div>
          <div className="guard-campus__caption"><span>{risks ? copy.modeRisk : copy.modeUsage}</span><span>{copy.selectHint}</span></div>
        </div>
        <div className="guard-campus__universes" role="group" aria-label={copy.choose}>
          {GUARD_UNIVERSES.map((id) => (
            <button type="button" key={id} aria-pressed={id === universe} aria-label={copy.universes[id].name} aria-controls="campus-detail" onClick={() => setUniverse(id)}>
              <span className="guard-campus__number" aria-hidden="true">{copy.universes[id].marker}</span>
              <span><strong>{copy.universes[id].name}</strong><small>{copy.universes[id].subtitle}</small></span>
              <span className="guard-campus__select-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
        <div className="guard-campus__control">
          <span className="guard-campus__control-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 4 4 7 8 9 4-2 8-5 8-9V6Z" /><path d="m8 12 3 3 5-6" /></svg></span>
          <div><strong>AI Guard</strong><span>{copy.guardRole}</span></div>
          <p>{copy.controls}</p>
        </div>
        <div className="guard-campus__detail" id="campus-detail" aria-live="polite" aria-atomic="true">
          <div className="guard-campus__daily">
            <p className="guard-campus__detail-label">{risks ? copy.modeRisk : copy.everyday}</p>
            <h3>{selected.name}</h3>
            {risks ? <ul className="guard-campus__risks">{selected.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul> : <><p>{selected.daily}</p><ul className="guard-campus__examples">{selected.examples.map((example) => <li key={example}>{example}</li>)}</ul></>}
          </div>
          <div className="guard-campus__safeguards">
            <p className="guard-campus__detail-label">{copy.controlsTitle}</p>
            <ul>{selected.safeguards.map((item, index) => <li key={item}><span aria-hidden="true">0{index + 1}</span>{item}</li>)}</ul>
          </div>
        </div>
        <div className="guard-campus__footnote"><p>{copy.scope}</p><Link href="/menaces">{copy.learnThreats} <span aria-hidden="true">↗</span></Link></div>
      </div>
    </section>
  );
}
