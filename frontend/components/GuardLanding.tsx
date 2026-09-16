"use client";

import Link from "next/link";
import { Wordmark, XsomMark } from "@/components/brand";
import { GUARD_COPY, HOME_HERO_MEDIA } from "@/components/guard-copy";
import { GUARD_HOME_COPY } from "@/components/guard-home-copy";
import { GuardCampus } from "@/components/GuardCampus";
import { GuardHeroVideo } from "@/components/GuardHeroVideo";
import { GuardNav } from "@/components/GuardNav";
import { Orientation } from "@/components/Orientation";
import { SignalPreferences } from "@/design-system/react";
import { useT } from "@/lib/i18n";

export function GuardLanding() {
  const { lang } = useT();
  const copy = GUARD_COPY[lang];
  const home = GUARD_HOME_COPY[lang];
  return (
    <main className="guard-landing guard-home">
      <header className="guard-header">
        <div className="guard-wrap guard-header__inner">
          <Link href="/" className="brand"><XsomMark /><Wordmark /></Link>
          <GuardNav />
        </div>
      </header>
      <section className="guard-masthead" aria-labelledby="home-heading">
        <GuardHeroVideo copy={home} media={HOME_HERO_MEDIA} />
        <div className="guard-masthead__scrim" aria-hidden="true" />
        <div className="guard-wrap guard-masthead__inner">
          <div className="guard-masthead__copy">
            <p className="guard-masthead__eyebrow"><span className="guard-french-mark" aria-hidden="true"><i /><i /><i /></span>{home.eyebrow}</p>
            <h1 id="home-heading"><span className="guard-product-name">xSOM AI Guard</span>{home.title[0]}<br /><span>{home.title[1]}</span></h1>
            <p className="guard-masthead__intro">{home.intro}</p>
            <div className="guard-masthead__actions reveal" data-delay="1"><a href="#usages" className="guard-button">{home.explore}<span aria-hidden="true">↓</span></a><Link href="/produits">{home.productsLink}<span aria-hidden="true">↗</span></Link></div>
            <p className="guard-masthead__note reveal" data-delay="2"><span />{copy.poc}</p>
          </div>
          <div className="guard-masthead__principles reveal" data-delay="3">{home.principles.map((principle, index) => <span key={principle}><small aria-hidden="true">0{index + 1}</small>{principle}</span>)}</div>
        </div>
      </section>
      <GuardCampus copy={home} />
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
