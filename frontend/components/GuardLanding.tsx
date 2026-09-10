"use client";

import Link from "next/link";
import { useState } from "react";
import { Wordmark, XsomMark } from "@/components/brand";
import { GUARD_COPY } from "@/components/guard-copy";
import { MenacesLanding } from "@/components/MenacesLanding";
import { Orientation } from "@/components/Orientation";
import { SignalPreferences } from "@/design-system/react";
import { LanguageToggle, useT } from "@/lib/i18n";

type Scenario = "document" | "code" | "action";
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
            <a href="#menaces-accueil">{copy.problemKicker}</a>
            <a href="#vous">{copy.whoKicker}</a>
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
          <a href="#menaces-accueil" className="guard-button">
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
      {/* La trame de la page, et c'est tout son objet : d'où vient le problème,
          puis qui vous êtes, puis où cela vous mène. L'ancienne suite (usages,
          principes, contact) posait trois fois la même question sans jamais aiguiller,
          si bien qu'on lisait la page sans savoir ce qu'on était censé en faire. */}
      <MenacesLanding copy={copy} />
      <Orientation copy={copy} />
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
