"use client";

import Link from "next/link";
import { useState } from "react";
import { Wordmark, XsomMark } from "@/components/brand";
import { GUARD_COPY } from "@/components/guard-copy";
import { SignalPreferences } from "@/design-system/react";
import { LanguageToggle, useT } from "@/lib/i18n";

type Scenario = "document" | "code" | "action";
type Audience = "people" | "developers" | "data";
type Destination = "cloud" | "internal";
type Copy = (typeof GUARD_COPY)[keyof typeof GUARD_COPY];

function Arrow({ vertical = false }: { vertical?: boolean }) {
  return (
    <span
      className={`guard-arrow${vertical ? " guard-arrow--vertical" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 80 24">
        <path d="M2 12h72m-8-8 8 8-8 8" />
      </svg>
    </span>
  );
}

/** Selections describe illustrative scenarios; they never execute an action. */
function ControlScene({ copy }: { copy: Copy }) {
  const [scenario, setScenario] = useState<Scenario>("action");
  const selected = copy.scenarios[scenario];
  return (
    <div className="guard-scene" data-scenario={scenario}>
      <div className="guard-scene__bar">
        <span>{copy.demo}</span>
        <span aria-hidden="true">01 — 03</span>
      </div>
      <div className="guard-examples" role="group" aria-label={copy.choose}>
        {(["document", "code", "action"] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={id === scenario}
            onClick={() => setScenario(id)}
          >
            {copy.examples[id]}
          </button>
        ))}
      </div>
      <div
        className="guard-stage"
        role="img"
        aria-label={`${copy.scene} : ${selected.source} → ${copy.control} → ${selected.target}`}
      >
        {/* Generated infrastructure illustration, not a deployment screenshot. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="guard-stage__image"
          src="/signal-media/infrastructure-hero.webp"
          alt=""
          width={1536}
          height={1024}
          fetchPriority="high"
        />
        <div className="guard-stage__node guard-stage__node--source">
          <span className="guard-mini-label">{copy.input}</span>
          <strong>{selected.source}</strong>
        </div>
        <div
          className="guard-stage__link guard-stage__link--left"
          key={`${scenario}-left`}
        >
          <Arrow />
        </div>
        <div className="guard-core">
          <div className="guard-core__label">
            <strong>{copy.control}</strong>
            <span>{copy.policy}</span>
          </div>
        </div>
        <div
          className="guard-stage__link guard-stage__link--right"
          key={`${scenario}-right`}
        >
          <Arrow />
        </div>
        <div className="guard-stage__node guard-stage__node--target">
          <span className="guard-mini-label">{copy.output}</span>
          <strong>{selected.target}</strong>
        </div>
      </div>
      <div
        className="guard-scene__result"
        aria-live="polite"
        aria-atomic="true"
      >
        <div>
          <span className="guard-mini-label">{selected.request}</span>
          <strong>{selected.rule}</strong>
        </div>
        <span className="guard-status">{selected.status}</span>
        <p>{selected.note}</p>
      </div>
    </div>
  );
}

function UsageExplorer({ copy }: { copy: Copy }) {
  const [audience, setAudience] = useState<Audience>("people");
  const [destination, setDestination] = useState<Destination>("cloud");
  const detail = copy.details[audience];
  return (
    <section
      id="usages"
      className="guard-usage guard-wrap"
      aria-labelledby="usage-heading"
    >
      <div className="guard-section-heading">
        <p className="guard-kicker">{copy.usageKicker}</p>
        <h2 id="usage-heading">{copy.usageTitle}</h2>
        <p>{copy.usageIntro}</p>
      </div>
      <div
        className="guard-audiences"
        role="group"
        aria-label={copy.usageTitle}
      >
        {(["people", "developers", "data"] as const).map((id, index) => (
          <button
            type="button"
            key={id}
            aria-pressed={audience === id}
            onClick={() => setAudience(id)}
          >
            <span aria-hidden="true">0{index + 1}</span>
            {copy.audiences[id]}
            <span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
      <div className="guard-usage__body">
        <div className="guard-usage__copy" aria-live="polite">
          <h3>{detail.title}</h3>
          <ul>
            {detail.list.map((item) => (
              <li key={item}>
                <span aria-hidden="true">↗</span>
                {item}
              </li>
            ))}
          </ul>
          <p className="guard-scope-note">{detail.note}</p>
        </div>
        <div className="guard-route">
          <fieldset className="guard-destinations">
            <legend>{copy.destination}</legend>
            <div>
              {(["cloud", "internal"] as const).map((id) => (
                <label key={id}>
                  <input
                    type="radio"
                    name="model-destination"
                    value={id}
                    checked={destination === id}
                    onChange={() => setDestination(id)}
                  />
                  <span>{id === "cloud" ? copy.cloud : copy.internal}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div
            className="guard-route__diagram"
            data-destination={destination}
            aria-live="polite"
          >
            <span className="guard-route__caption">{copy.routeLabel}</span>
            <div className="guard-route__origin">
              <span>{detail.source}</span>
              <Arrow />
              <strong>{detail.middle}</strong>
            </div>
            <Arrow vertical />
            <div className="guard-route__gate">
              <strong>AI Guard</strong>
              <span>{copy.policy}</span>
            </div>
            <Arrow vertical />
            <div className="guard-route__destination" key={destination}>
              <div className="guard-model-stack" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <div>
                <strong>
                  {destination === "cloud"
                    ? copy.cloudNames
                    : copy.internalNames}
                </strong>
                <span>
                  {destination === "cloud"
                    ? copy.cloudDetail
                    : copy.internalDetail}
                </span>
              </div>
            </div>
          </div>
          <p className="guard-route__scope">{copy.routeScope}</p>
        </div>
      </div>
      <Link href="/triage" className="guard-link">
        {copy.next}
        <span aria-hidden="true">↗</span>
      </Link>
    </section>
  );
}

export function GuardLanding() {
  const { lang } = useT();
  const copy = GUARD_COPY[lang];
  return (
    <main className="guard-landing">
      <header className="guard-header">
        <div className="guard-wrap guard-header__inner">
          <Link href="/" className="brand">
            <XsomMark />
            <Wordmark />
          </Link>
          <nav
            aria-label={
              lang === "fr" ? "Navigation principale" : "Main navigation"
            }
          >
            <a href="#usages">{copy.explore}</a>
            <Link href="/evidence">{copy.evidence}</Link>
            <LanguageToggle />
            <Link href="/login" className="guard-button guard-button--small">
              {copy.signin}
              <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </div>
      </header>
      <section className="guard-hero guard-wrap">
        <div className="guard-hero__copy">
          <p className="guard-kicker">{copy.lab}</p>
          <h1>
            <span className="guard-product-name">xSOM AI Guard</span>
            {copy.title[0]}
            <br />
            <span>{copy.title[1]}</span>
          </h1>
          <p className="guard-hero__intro">{copy.intro}</p>
          <a href="#usages" className="guard-button">
            {copy.explore}
            <span aria-hidden="true">↓</span>
          </a>
          <p className="guard-hero__note">
            <span className="guard-poc-label">{copy.poc}</span>
            {copy.heroNote}
          </p>
        </div>
        <ControlScene copy={copy} />
      </section>
      <UsageExplorer copy={copy} />
      <section className="guard-principles">
        <div className="guard-wrap">
          <div className="guard-section-heading">
            <h2>{copy.whyTitle}</h2>
            <p>{copy.whyIntro}</p>
          </div>
          <ol>
            {copy.steps.map((step, index) => (
              <li key={step.title}>
                <span className="guard-step-number">0{index + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
                {index < 2 && <Arrow />}
              </li>
            ))}
          </ol>
          <details className="guard-limits">
            <summary>
              {copy.limits}
              <span aria-hidden="true">+</span>
            </summary>
            <p>{copy.limitsText}</p>
            <Link className="guard-link" href="/evidence">
              {copy.evidence}
              <span aria-hidden="true">↗</span>
            </Link>
          </details>
        </div>
      </section>
      <section className="guard-contact guard-wrap">
        <div>
          <p className="guard-kicker">{copy.poc}</p>
          <h2>{copy.finalTitle}</h2>
          <p>{copy.finalBody}</p>
        </div>
        <a
          href="mailto:julian.talou@xsom.fr?subject=xSOM%20AI%20Guard%20%3A%20cas%20d%E2%80%99usage"
          className="guard-button"
        >
          {copy.contact}
          <span aria-hidden="true">↗</span>
        </a>
      </section>
      <footer className="guard-footer">
        <div className="guard-wrap">
          <div className="brand">
            <XsomMark />
            <Wordmark />
          </div>
          <p>{copy.footer}</p>
          <a href="https://www.xsom.fr" target="_blank" rel="noreferrer">
            {copy.cabinet} ↗
          </a>
          <details>
            <summary>{lang === "fr" ? "Affichage" : "Display"}</summary>
            <SignalPreferences lang={lang} />
          </details>
        </div>
      </footer>
    </main>
  );
}
