"use client";

import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { GUARD_OFFER_FAMILIES_COPY } from "@/components/guard-offers-copy";
import { useT } from "@/lib/i18n";
import extension from "@/public/signal-media/ai-guard-extension-v2.jpg";
import consoleShot from "@/public/signal-media/ai-guard-console.png";
import infrastructure from "@/public/signal-media/infrastructure-hero.webp";
import { HOME_COPY } from "./home-copy";

type OfferId = (typeof GUARD_OFFER_FAMILIES_COPY)["fr"]["offers"][number]["id"];

/** Une image réelle par voie : l'extension, la console, l'infrastructure du cabinet. */
const MEDIA: Record<OfferId, { image: StaticImageData; position: string }> = {
  "open-source": { image: extension, position: "70% 50%" },
  software: { image: consoleShot, position: "0% 0%" },
  consulting: { image: infrastructure, position: "50% 45%" },
};

/**
 * Les trois façons d'avancer, en volets : un seul s'ouvre à la fois au survol, au
 * focus ou au clic ; sur mobile, les trois sont dépliés l'un sous l'autre.
 */
export function HomePaths() {
  const { lang } = useT();
  const offers = GUARD_OFFER_FAMILIES_COPY[lang];
  const copy = HOME_COPY[lang].paths;
  const [active, setActive] = useState(1);

  return (
    <section id="offres" className="home-paths" aria-labelledby="offers-heading">
      <div className="guard-wrap">
        <header className="home-paths__head">
          <p className="home-kicker" data-reveal>{copy.kicker}</p>
          <h2 id="offers-heading" className="home-title" data-reveal style={{ "--chars": offers.title.length } as CSSProperties}>{offers.title}</h2>
          <p className="home-lead" data-reveal>{offers.intro}</p>
        </header>
        <div className="home-paths__rail" data-reveal>
          {offers.offers.map((offer, index) => {
            const open = index === active;
            const media = MEDIA[offer.id];
            return (
              <article
                key={offer.id}
                className="home-path"
                data-offer={offer.id}
                data-open={open}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
              >
                <Image className="home-path__media" src={media.image} alt="" sizes="(max-width: 900px) 100vw, 50vw" style={{ objectPosition: media.position }} />
                <div className="home-path__shade" aria-hidden="true" />
                <div className="home-path__body">
                  <p className="home-path__badge">{offer.badge}</p>
                  <h3>
                    <button type="button" aria-expanded={open} aria-controls={`path-${offer.id}`} onClick={() => setActive(index)}>
                      {offer.name}
                    </button>
                  </h3>
                  <div id={`path-${offer.id}`} className="home-path__detail">
                    <div className="home-path__detail-inner">
                      <p>{offer.body}</p>
                      <ul>{offer.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                      {offer.href.startsWith("/")
                        ? <Link className="guard-button" href={offer.href}>{offer.action} <span aria-hidden="true">↗</span></Link>
                        : <a className="guard-button" href={offer.href} target="_blank" rel="noreferrer">{offer.action} <span aria-hidden="true">↗</span></a>}
                    </div>
                  </div>
                  <span className="home-path__hint" aria-hidden="true">{copy.open} →</span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
