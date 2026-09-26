"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { glideTo, motionReduced } from "@/components/home/motion";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/home/icons";
import { useT } from "@/lib/i18n";
import consoleShot from "@/public/signal-media/ai-guard-console.png";
import secretGuardShot from "@/public/signal-media/secret-guard-vscode.png";
import { PRODUCTS_COPY } from "./products-copy";

const SHOTS = { "secret-guard": secretGuardShot, "ai-guard": consoleShot } as const;

/**
 * Les produits, un par diapositive. La piste défile nativement (balayage au doigt,
 * aimantation) ; les sélecteurs et les flèches la font glisser, et la diapositive
 * courante se déduit de sa position. Rien ne défile tout seul.
 */
export function ProductsCarousel() {
  const { lang } = useT();
  const copy = PRODUCTS_COPY[lang];
  const track = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const last = copy.slides.length - 1;

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setCurrent(Math.round(element.scrollLeft / element.clientWidth));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    element.addEventListener("scroll", schedule, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      element.removeEventListener("scroll", schedule);
    };
  }, []);

  const show = (index: number) => {
    const element = track.current;
    if (!element) return;
    const target = Math.min(last, Math.max(0, index));
    element.scrollTo({ left: target * element.clientWidth, behavior: motionReduced() ? "auto" : "smooth" });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") show(current - 1);
    else if (event.key === "ArrowRight") show(current + 1);
  };

  return (
    <section id="gamme" className="xp-range" aria-labelledby="products-heading">
      <div className="guard-wrap">
        <header>
          <p className="home-kicker" data-reveal>{copy.kicker}</p>
          <h1 id="products-heading" className="home-title" data-reveal style={{ "--chars": copy.title.length } as CSSProperties}>
            {copy.title}
          </h1>
        </header>

        <div className="xp-carousel" role="region" aria-roledescription="carousel" aria-label={copy.carousel} data-reveal>
          <div className="xp-carousel__controls" onKeyDown={onKeyDown}>
            <div className="xp-carousel__pickers" role="group" aria-label={copy.carousel}>
              {copy.slides.map((slide, index) => (
                <button key={slide.id} type="button" aria-controls={`produit-${slide.id}`} aria-pressed={index === current} onClick={() => show(index)}>
                  <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{slide.name}
                </button>
              ))}
            </div>
            <div className="xp-carousel__arrows">
              <button type="button" onClick={() => show(current - 1)} disabled={current === 0} aria-label={copy.previous} title={copy.previous}>
                <ChevronLeftIcon />
              </button>
              <button type="button" onClick={() => show(current + 1)} disabled={current === last} aria-label={copy.next} title={copy.next}>
                <ChevronRightIcon />
              </button>
            </div>
          </div>

          <div ref={track} className="xp-carousel__track">
            {copy.slides.map((slide, index) => (
              <article
                key={slide.id}
                id={`produit-${slide.id}`}
                className="xp-slide"
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} ${copy.of} ${copy.slides.length}${lang === "fr" ? " : " : ": "}${slide.name}`}
              >
                <div>
                  <p className="xp-slide__tag">{slide.tag}</p>
                  <h2>{slide.name}</h2>
                  <p className="xp-slide__lead">{slide.lead}</p>
                  <p className="xp-slide__body">{slide.body}</p>
                  <ul>{slide.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                  <div className="xp-slide__actions">
                    <Link className="guard-button" href={slide.primary.href}>{slide.primary.label} <span aria-hidden="true">↗</span></Link>
                    <a className="xp-slide__link" href={slide.secondary.href} onClick={glideTo}>{slide.secondary.label}</a>
                  </div>
                  <p className="xp-slide__note">{slide.note}</p>
                </div>
                <figure className="xp-slide__shot">
                  <Image src={SHOTS[slide.id]} alt={slide.imageAlt} sizes="(max-width: 900px) 92vw, 44vw" placeholder="blur" />
                </figure>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
