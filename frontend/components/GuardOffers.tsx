"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";
import { GUARD_OFFERS_COPY, GUARD_OFFER_FAMILIES_COPY } from "./guard-offers-copy";
import { OfferDiagram } from "./OfferDiagram";
import "@/app/guard-marketing.css";

export function GuardOfferFamilies() {
  const { lang } = useT();
  const copy = GUARD_OFFER_FAMILIES_COPY[lang];
  return (
    <section className="guard-commercial guard-wrap guard-offer-families" aria-labelledby="offers-heading" id="offres">
      <header className="guard-commercial__heading reveal">
        <p className="guard-kicker">{copy.kicker}</p>
        <h2 id="offers-heading">{copy.title}</h2>
        <p>{copy.intro}</p>
      </header>
      <div className="guard-offers">
        {copy.offers.map((offer, index) => (
          <article key={offer.id} data-offer={offer.id} className="reveal" data-delay={index + 1}>
            <p className="guard-offers__badge">{offer.badge}</p>
            <h3>{offer.name}</h3>
            <p>{offer.body}</p>
            <ul>{offer.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            {offer.href.startsWith("/")
              ? <Link className="guard-button" href={offer.href}>{offer.action} ↗</Link>
              : <a className="guard-button" href={offer.href} target="_blank" rel="noreferrer">{offer.action} ↗</a>}
          </article>
        ))}
      </div>
    </section>
  );
}

export function GuardOffers() {
  const { lang } = useT();
  const copy = GUARD_OFFERS_COPY[lang];
  return <section className="guard-commercial guard-wrap" aria-labelledby="offers-heading" id="offres">
    <header className="guard-commercial__heading"><p className="guard-kicker">{copy.kicker}</p><h2 id="offers-heading">{copy.title}</h2><p>{copy.intro}</p></header>
    <div className="guard-offers">{copy.offers.map((offer) => <article key={offer.id} data-offer={offer.id}>
      <p className="guard-offers__badge">{offer.badge}</p><p className="guard-offers__audience">{offer.audience}</p><h3>{offer.name}</h3>
      <p className="guard-offers__price"><strong>{offer.price}</strong><span>{offer.unit}</span></p>
      <p>{offer.body}</p><ul>{offer.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
      <OfferDiagram kind={offer.diagram} copy={copy.diagram} />
      {offer.href.startsWith("/") ? <Link className="guard-button" href={offer.href}>{offer.action} ↗</Link> : <a className="guard-button" href={offer.href}>{offer.action} ↗</a>}
      <p className="guard-offers__note">{offer.note}</p>
    </article>)}</div>
    <p className="guard-commercial__note">{copy.priceNote}</p>
  </section>;
}

export function GuardOfferQuestions() {
  const { lang } = useT();
  const copy = GUARD_OFFERS_COPY[lang];
  return <section className="guard-commercial guard-wrap guard-offer-faq" aria-labelledby="offer-faq-heading"><h2 id="offer-faq-heading">{copy.faqTitle}</h2>{copy.faqs.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</section>;
}
