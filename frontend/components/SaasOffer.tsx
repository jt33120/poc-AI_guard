"use client";

/**
 * L'offre libre-service, et son guide de démarrage.
 *
 * C'est la destination du chemin « développeur » de l'accueil. Le chemin « conseil »,
 * lui, reste un courriel : une prestation se discute, elle ne s'achète pas au clic.
 *
 * **La page dit ce que le produit sait faire, pas ce qu'un palier accorde.** Les six
 * familles couvrent l'inventaire réel — chaque ligne a son module et ses tests — et
 * `0033` fait naître un inscrit au palier le plus large pour que la page reste vraie
 * à l'inscription. Le jour où la facturation revient, c'est cette page qu'il faudra
 * rabattre en même temps que le défaut de palier, et pas l'une sans l'autre.
 *
 * **Trois bornes, et elles sont sur la page plutôt qu'en bas de page** : la passerelle
 * contraignante ne s'ouvre pas toute seule (elle s'installe) ; ce qui ne passe pas par
 * nous n'est pas contrôlé ; et ce qui est *bloqué* se distingue de ce qui est
 * *orchestré* ou seulement *attesté* — cette distinction-là vit sur `/evidence`, qui
 * la prouve ligne par ligne, et le lien y mène depuis l'inventaire.
 *
 * Les quatre gestes sont ceux de l'assistant d'intégration de la console, dans le même
 * ordre et avec les mêmes noms. Une page publique qui décrirait une autre suite
 * apprendrait à faire ce qui ne marchera pas — c'est pourquoi « Brancher » parle de
 * l'appel de décision et du proxy, les deux voies qu'un inscrit obtient vraiment.
 */

import Link from "next/link";

import { Wordmark, XsomMark } from "@/components/brand";
import { CONTACT_MAILTO, GUARD_COPY } from "@/components/guard-copy";
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
        <p className="guard-saas-open">{copy.saasOpen}</p>
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
          {copy.saasFamilies.map((famille) => (
            <li key={famille.title}>
              <h3>{famille.title}</h3>
              <p>{famille.body}</p>
              <ul>
                {famille.list.map((ligne) => (
                  <li key={ligne}>
                    <span aria-hidden="true">↗</span>
                    {ligne}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {/* Le relevé prouve la nuance que l'inventaire ne porte pas : une ligne
            « garde-prompt » y est publiée `Orchestré`, pas `Bloqué`. Sans ce lien,
            l'inventaire se lirait comme une liste de garanties. */}
        <a className="guard-link" href="/evidence">
          {copy.saasProof}
          <span aria-hidden="true">↗</span>
        </a>
      </section>

      <section
        className="guard-gateway guard-wrap"
        aria-labelledby="gateway-heading"
      >
        <h2 id="gateway-heading">{copy.saasGatewayTitle}</h2>
        <p>{copy.saasGatewayBody}</p>
        <a className="guard-link" href={CONTACT_MAILTO}>
          {copy.saasGatewayCta}
          <span aria-hidden="true">↗</span>
        </a>
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
