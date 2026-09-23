"use client";

import Image from "next/image";
import Link from "next/link";
import { Wordmark, XsomMark } from "@/components/brand";
import { CONTACT_MAILTO, GUARD_COPY } from "@/components/guard-copy";
import { GUARD_HOME_COPY } from "@/components/guard-home-copy";
import { GuardNav } from "@/components/GuardNav";
import { GuardOffers, GuardPublisher } from "@/components/GuardOffers";
import { SignalPreferences } from "@/design-system/react";
import { useT } from "@/lib/i18n";

export function ProductsOffer() {
  const { lang } = useT();
  const copy = GUARD_COPY[lang];
  const home = GUARD_HOME_COPY[lang];
  return <main className="guard-landing guard-home">
    <header className="guard-header"><div className="guard-wrap guard-header__inner"><Link href="/" className="brand"><XsomMark /><Wordmark /></Link><GuardNav /></div></header>
    <section className="guard-home-section guard-products-page guard-wrap" aria-labelledby="products-heading">
      <div className="guard-home-heading"><p className="guard-kicker">{lang === "fr" ? "LA GAMME XSOM · ÉDITEUR FRANÇAIS" : "XSOM PRODUCTS · FRENCH PUBLISHER"}</p><h1 id="products-heading">{home.productsTitle}</h1><p>{home.productsIntro}</p></div>
      <article className="guard-product-feature">
        <div className="guard-product-feature__copy">
          <p className="guard-product-feature__tag">01 / DEVELOPER GUARD</p>
          <h2>{lang === "fr" ? "Vos agents. Votre cadre." : "Your agents. Your rules."}</h2>
          <p className="guard-product-feature__lead">{lang === "fr" ? "Gardez la vitesse de l’IA et la maîtrise de vos décisions." : "Keep AI’s speed and control over your decisions."}</p>
          <p>{lang === "fr" ? "Démarrez avec Secret Guard Local gratuit. Passez au cadre Équipe pour distribuer vos règles, faire valider les actions sensibles et suivre les décisions. xSOM accompagne la qualification de vos assistants et de votre environnement." : "Start with free Secret Guard Local. Move to Team to distribute policies, approve sensitive actions and track decisions. xSOM helps qualify your assistants and environment."}</p>
          <ul><li>{lang === "fr" ? "Détection de secrets sur le poste" : "On-device secret detection"}</li><li>{lang === "fr" ? "Politiques d’entreprise et validations ciblées" : "Company policies and focused approvals"}</li><li>{lang === "fr" ? "Un éditeur français identifié pour le support et le contrat" : "An identified French publisher for support and contract"}</li></ul>
          <Link href="/developpeurs" className="guard-button">{lang === "fr" ? "Découvrir Developer Guard" : "Discover Developer Guard"} ↗</Link>
          <p className="guard-product-feature__note">{lang === "fr" ? "Claude Code, Codex, Copilot : le pilote vérifie chaque capacité dans vos versions. Le VSIX gratuit ne vaut pas activation du service Équipe." : "Claude Code, Codex, Copilot: the pilot checks each capability in your versions. The free VSIX does not activate the Team service."}</p>
        </div>
        <figure className="guard-product-shot"><Image src="/signal-media/secret-guard-panneau.png" alt={home.extensionShotAlt} width={958} height={1110} sizes="(max-width: 800px) 100vw, 46vw" /><figcaption>{home.extensionShotCaption}</figcaption></figure>
      </article>
    </section>
    <GuardOffers />
    <section className="guard-commercial guard-wrap" aria-labelledby="platform-heading">
      <article className="guard-product-feature">
        <div className="guard-product-feature__copy">
          <p className="guard-product-feature__tag">02 / AI GUARD</p><h2 id="platform-heading">{home.platformTitle}</h2><p className="guard-product-feature__lead">{home.platformIntro}</p><p>{home.platformBody}</p>
          <ul>{home.platformFeatures.map((feature) => <li key={feature}>{feature}</li>)}</ul>
          <Link href="/saas" className="guard-button">{lang === "fr" ? "Explorer la plateforme" : "Explore the platform"} ↗</Link>
          <a className="guard-link" href={CONTACT_MAILTO}>{lang === "fr" ? "Chiffrer une intégration" : "Request an integration quote"} ↗</a>
          <p className="guard-product-feature__note">{lang === "fr" ? "Console de découverte gratuite. Passerelle et intégration sur devis, distinctes des tarifs Developer Guard. Seuls les outils raccordés sont contrôlés." : "Free discovery console. Gateway and integration quoted separately from Developer Guard pricing. Only connected tools are controlled."}</p>
        </div>
        <figure className="guard-product-shot"><Image src="/signal-media/ai-guard-console.png" alt={home.platformShotAlt} width={2880} height={2600} sizes="(max-width: 800px) 100vw, 46vw" /><figcaption>{home.platformShotCaption}</figcaption></figure>
      </article>
    </section>
    <aside className="guard-glossary-link guard-wrap reveal"><span className="guard-glossary-link__icon" aria-hidden="true">Aa</span><div><h3>{home.glossaryTitle}</h3><p>{home.glossaryBody}</p></div><Link href="/menaces">{home.glossaryAction} ↗</Link></aside>
    <GuardPublisher />
    <footer className="guard-footer"><div className="guard-wrap"><div className="brand"><XsomMark /><Wordmark /></div><p>{copy.footer}</p><Link href="/developpeurs/confiance">{lang === "fr" ? "Engagement xSOM" : "xSOM commitment"}</Link><a href="https://www.xsom.fr" target="_blank" rel="noreferrer">{copy.cabinet} ↗</a><details><summary>{lang === "fr" ? "Affichage" : "Display"}</summary><SignalPreferences lang={lang} /></details></div></footer>
  </main>;
}
