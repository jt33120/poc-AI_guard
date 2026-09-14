"use client";

import Link from "next/link";
import { Wordmark, XsomMark } from "@/components/brand";
import { GUARD_COPY } from "@/components/guard-copy";
import { GUARD_HOME_COPY, type GuardHomeCopy } from "@/components/guard-home-copy";
import { GuardCampus } from "@/components/GuardCampus";
import { GuardHeroVideo } from "@/components/GuardHeroVideo";
import { Orientation } from "@/components/Orientation";
import { SignalPreferences } from "@/design-system/react";
import { LanguageToggle, useT } from "@/lib/i18n";

function Products({ copy }: { copy: GuardHomeCopy }) {
  return (
    <section id="produits" className="guard-home-section guard-products guard-wrap" aria-labelledby="products-heading">
      <div className="guard-home-heading">
        <p className="guard-kicker">{copy.productsKicker}</p>
        <h2 id="products-heading">{copy.productsTitle}</h2>
        <p>{copy.productsIntro}</p>
      </div>
      <article className="guard-product-feature">
        <div className="guard-product-feature__copy">
          <p className="guard-product-feature__tag"><span aria-hidden="true" />{copy.featured}</p>
          <h3>{copy.extensionTitle}</h3>
          <p className="guard-product-feature__lead">{copy.extensionIntro}</p>
          <p>{copy.extensionBody}</p>
          <ul>{copy.extensionFeatures.map((feature) => <li key={feature}>{feature}</li>)}</ul>
          <Link href="/extension" className="guard-button">{copy.extensionAction}<span aria-hidden="true">↗</span></Link>
          <p className="guard-product-feature__note">{copy.extensionNote}</p>
        </div>
        <div className="guard-product-preview" aria-label={copy.preview}>
          <div className="guard-product-preview__bar"><span aria-hidden="true">⌘</span><strong>AI Guard / VS Code</strong><span>{copy.preview}</span></div>
          <div className="guard-product-preview__editor">
            <div><span aria-hidden="true">01</span><p>{copy.previewPrompt}</p></div>
            <div><span aria-hidden="true">02</span><code>API_KEY = <mark>{copy.previewValue}</mark></code></div>
            <div><span aria-hidden="true">03</span><span className="guard-product-preview__cursor" aria-hidden="true" /></div>
          </div>
          <div className="guard-product-preview__decision">
            <span className="guard-product-preview__alert" aria-hidden="true">!</span>
            <div><span>{copy.previewSecret}</span><strong>{copy.previewDecision}</strong><p>{copy.previewDetail}</p></div>
          </div>
          <p className="guard-product-preview__foot">{copy.previewLocal}</p>
        </div>
      </article>
      <article className="guard-platform-product">
        <div><p className="guard-kicker">{copy.platformTag}</p><h3>{copy.platformTitle}</h3><p>{copy.platformBody}</p></div>
        <Link href="/saas" className="guard-link">{copy.platformAction}<span aria-hidden="true">↗</span></Link>
      </article>
      <aside className="guard-glossary-link">
        <span className="guard-glossary-link__icon" aria-hidden="true">Aa</span>
        <div><h3>{copy.glossaryTitle}</h3><p>{copy.glossaryBody}</p></div>
        <Link href="/menaces">{copy.glossaryAction}<span aria-hidden="true">↗</span></Link>
      </aside>
    </section>
  );
}

export function GuardLanding() {
  const { lang } = useT();
  const copy = GUARD_COPY[lang];
  const home = GUARD_HOME_COPY[lang];
  return (
    <main className="guard-landing guard-home">
      <header className="guard-header">
        <div className="guard-wrap guard-header__inner">
          <Link href="/" className="brand"><XsomMark /><Wordmark /></Link>
          <nav aria-label={lang === "fr" ? "Navigation principale" : "Main navigation"}>
            <a href="#usages">{home.navUsages}</a>
            <a href="#produits">{home.navProducts}</a>
            <Link href="/menaces">{home.navGlossary}</Link>
            <Link href="/extension" className="guard-home-nav-secondary">{copy.extNav}</Link>
            <LanguageToggle />
            <Link href="/login" className="guard-button guard-button--small">{copy.signin}<span aria-hidden="true">↗</span></Link>
          </nav>
        </div>
      </header>
      <section className="guard-masthead" aria-labelledby="home-heading">
        <GuardHeroVideo copy={home} />
        <div className="guard-masthead__scrim" aria-hidden="true" />
        <div className="guard-wrap guard-masthead__inner">
          <div className="guard-masthead__copy">
            <p className="guard-masthead__eyebrow"><span className="guard-french-mark" aria-hidden="true"><i /><i /><i /></span>{home.eyebrow}</p>
            <h1 id="home-heading"><span className="guard-product-name">xSOM AI Guard</span>{home.title[0]}<br /><span>{home.title[1]}</span></h1>
            <p className="guard-masthead__intro">{home.intro}</p>
            <div className="guard-masthead__actions"><a href="#usages" className="guard-button">{home.explore}<span aria-hidden="true">↓</span></a><a href="#produits">{home.productsLink}<span aria-hidden="true">↗</span></a></div>
            <p className="guard-masthead__note"><span />{copy.poc}</p>
          </div>
          <div className="guard-masthead__principles">{home.principles.map((principle, index) => <span key={principle}><small aria-hidden="true">0{index + 1}</small>{principle}</span>)}</div>
        </div>
      </section>
      <GuardCampus copy={home} />
      <Products copy={home} />
      <Orientation copy={copy} />
      <footer className="guard-footer">
        <div className="guard-wrap">
          <div className="brand"><XsomMark /><Wordmark /></div>
          <p>{copy.footer}</p>
          <Link href="/evidence">{copy.evidence}</Link>
          <a href="https://www.xsom.fr" target="_blank" rel="noreferrer">{copy.cabinet} ↗</a>
          <details><summary>{lang === "fr" ? "Affichage" : "Display"}</summary><SignalPreferences lang={lang} /></details>
        </div>
      </footer>
    </main>
  );
}
