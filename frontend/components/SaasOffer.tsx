"use client";

/**
 * L'offre libre-service, et son guide de démarrage.
 *
 * C'est la destination du chemin « développeur » de l'accueil. Le chemin « conseil »,
 * lui, reste un courriel : une prestation se discute, elle ne s'achète pas au clic.
 *
 * **Ce que cette page promet est borné à ce qui est branché.** La note de bas de page
 * n'est pas une réserve juridique posée après coup : elle dit la seule chose qui
 * détermine le périmètre réel, et un lecteur qui la manque installera la passerelle en
 * croyant couvrir des flux qui ne passent pas par elle.
 *
 * Les quatre gestes sont ceux de l'assistant d'intégration de la console, dans le même
 * ordre et avec les mêmes noms. Une page publique qui décrirait une autre suite
 * apprendrait à faire ce qui ne marchera pas.
 */

import Link from "next/link";

import { Wordmark, XsomMark } from "@/components/brand";
import { GUARD_COPY } from "@/components/guard-copy";
import { SignalPreferences } from "@/design-system/react";
import { LanguageToggle, useT } from "@/lib/i18n";

export function SaasOffer() {
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
            <Link href="/">{copy.saasBack}</Link>
            <Link href="/evidence">{copy.evidence}</Link>
            <LanguageToggle />
            <Link href="/login" className="guard-button guard-button--small">
              {copy.signin}
              <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </div>
      </header>

      <section className="guard-saas-hero guard-wrap">
        <p className="guard-kicker">{copy.saasKicker}</p>
        <h1>{copy.saasTitle}</h1>
        <p className="guard-hero__intro">{copy.saasIntro}</p>
        <Link href="/signup" className="guard-button">
          {copy.saasCta}
          <span aria-hidden="true">↗</span>
        </Link>
      </section>

      <section
        className="guard-included guard-wrap"
        aria-labelledby="included-heading"
      >
        <div className="guard-section-heading">
          <h2 id="included-heading">{copy.saasIncluded}</h2>
        </div>
        <ul className="guard-included__list">
          {copy.saasIncludes.map((item) => (
            <li key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="guard-start guard-wrap"
        aria-labelledby="start-heading"
      >
        <div className="guard-section-heading">
          <h2 id="start-heading">{copy.saasStart}</h2>
          <p>{copy.saasStartIntro}</p>
        </div>
        <ol className="guard-start__steps">
          {copy.saasSteps.map((step, index) => (
            <li key={step.title}>
              <span className="guard-step-number">0{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <Link href="/signup" className="guard-button">
          {copy.saasCta}
          <span aria-hidden="true">↗</span>
        </Link>
        <p className="guard-start__note">
          <span className="guard-poc-label">{copy.poc}</span>
          {copy.saasNote}
        </p>
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
