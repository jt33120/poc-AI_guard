"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";
import { GUARD_OFFERS_COPY } from "./guard-offers-copy";
import "@/app/guard-marketing.css";

export function GuardOffers() {
  const { lang } = useT();
  const copy = GUARD_OFFERS_COPY[lang];
  return <section className="guard-commercial guard-wrap" aria-labelledby="offers-heading" id="offres">
    <header className="guard-commercial__heading"><p className="guard-kicker">{copy.kicker}</p><h2 id="offers-heading">{copy.title}</h2><p>{copy.intro}</p></header>
    <div className="guard-offers">{copy.offers.map((offer) => <article key={offer.id} data-offer={offer.id}>
      <p className="guard-offers__badge">{offer.badge}</p><p className="guard-offers__audience">{offer.audience}</p><h3>{offer.name}</h3>
      <p className="guard-offers__price"><strong>{offer.price}</strong><span>{offer.unit}</span></p>
      <p>{offer.body}</p><ul>{offer.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
      {offer.href.startsWith("/") ? <Link className="guard-button" href={offer.href}>{offer.action} ↗</Link> : <a className="guard-button" href={offer.href}>{offer.action} ↗</a>}
      <p className="guard-offers__note">{offer.note}</p>
    </article>)}</div>
    <p className="guard-commercial__note">{copy.priceNote}</p>
  </section>;
}

export function GuardPublisher() {
  const { lang } = useT();
  const copy = GUARD_OFFERS_COPY[lang];
  return <section className="guard-commercial guard-wrap guard-publisher" aria-labelledby="publisher-heading">
    <div><p className="guard-kicker">{copy.trustKicker}</p><h2 id="publisher-heading">{copy.trustTitle}</h2><p>{copy.trustBody}</p><Link className="guard-link" href="/developpeurs/confiance">{copy.trustAction} ↗</Link></div>
    <div><h3>{copy.sovereigntyTitle}</h3><p>{copy.sovereigntyBody}</p><Link className="guard-link" href="/developpeurs/securite">{copy.sovereigntyAction} ↗</Link></div>
  </section>;
}

export function GuardOfferQuestions() {
  const { lang } = useT();
  const copy = GUARD_OFFERS_COPY[lang];
  return <section className="guard-commercial guard-wrap guard-offer-faq" aria-labelledby="offer-faq-heading"><h2 id="offer-faq-heading">{copy.faqTitle}</h2>{copy.faqs.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</section>;
}
