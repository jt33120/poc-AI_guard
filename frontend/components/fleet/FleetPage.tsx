"use client";

import Image from "next/image";
import { useRef, type CSSProperties } from "react";
import { GuardFooter } from "@/components/GuardFooter";
import { HomeHeader } from "@/components/home/HomeHeader";
import { ActivityIcon, CodeIcon, ServerIcon, ShieldCheckIcon } from "@/components/home/icons";
import { glideTo } from "@/components/home/motion";
import { useHomeReveal } from "@/components/home/useHomeReveal";
import { HOSTS } from "@/components/secret-guard/hosts";
import { useT } from "@/lib/i18n";
import { FLEET_CONTACT, FLEET_COPY } from "./fleet-copy";

const FLEET_HOSTS = HOSTS.filter((host) => host.id !== "github-copilot");
const PILLAR_ICONS = [ServerIcon, CodeIcon, ActivityIcon, ShieldCheckIcon];

/**
 * La page xSOM Fleet, servie à la racine de `fleet.xsom.fr`. Elle reprend l'en-tête
 * et le style de l'accueil (`.xhome`) et les tuiles de logos de Secret Guard
 * (`.xsg`) ; ce qui lui est propre vit sous `.xfl` (`fleet.css`).
 */
export function FleetPage() {
  const root = useRef<HTMLDivElement>(null);
  useHomeReveal(root);
  const { lang } = useT();
  const copy = FLEET_COPY[lang];
  const title = (text: string) => ({ "--chars": text.length }) as CSSProperties;

  return (
    <div ref={root} className="guard-landing xhome xsg xfl">
      <HomeHeader />
      <main>
        <section className="fl-hero" aria-labelledby="fl-title">
          <div className="guard-wrap fl-hero__inner">
            <p className="home-kicker">{copy.hero.kicker}</p>
            <h1 id="fl-title" className="fl-hero__title">
              {copy.hero.title[0]}<br /><span>{copy.hero.title[1]}</span>
            </h1>
            <p className="fl-hero__lead">{copy.hero.lead}</p>
            <div className="fl-hero__actions">
              <a className="guard-button" href={FLEET_CONTACT}>{copy.hero.contact}</a>
              <a className="fl-hero__how" href="#fonctionnement" onClick={glideTo}>{copy.hero.how}</a>
            </div>
            <div className="fl-hero__hosts">
              <p>{copy.hero.hosts}</p>
              <ul>
                {FLEET_HOSTS.map((host) => (
                  <li key={host.id}>
                    <span className="sg-logo" data-host={host.id}><Image src={host.logo} alt="" width={44} height={44} /></span>
                    {host.name}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="fl-section" aria-labelledby="fl-cost-title">
          <div className="guard-wrap">
            <header className="fl-head">
              <p className="home-kicker" data-reveal>{copy.cost.kicker}</p>
              <h2 id="fl-cost-title" className="home-title" data-reveal style={title(copy.cost.title)}>{copy.cost.title}</h2>
            </header>
            <div className="fl-bills" data-reveal>
              {([["api", copy.cost.api], ["seat", copy.cost.seat]] as const).map(([id, bill]) => (
                <article key={id} className="fl-bill" data-bill={id}>
                  <p className="fl-bill__label">{bill.label}</p>
                  <p className="fl-bill__value">{bill.value}</p>
                  <p className="fl-bill__unit">{bill.unit}</p>
                  <p className="fl-bill__source">{bill.source}</p>
                </article>
              ))}
            </div>
            <p className="fl-note" data-reveal>{copy.cost.note}</p>
          </div>
        </section>

        <section id="fonctionnement" className="fl-section fl-section--tint" aria-labelledby="fl-how-title">
          <div className="guard-wrap">
            <header className="fl-head">
              <p className="home-kicker" data-reveal>{copy.pillars.kicker}</p>
              <h2 id="fl-how-title" className="home-title" data-reveal style={title(copy.pillars.title)}>{copy.pillars.title}</h2>
            </header>
            <ul className="fl-grid">
              {copy.pillars.items.map(([name, body], index) => {
                const Glyph = PILLAR_ICONS[index];
                return (
                  <li key={name} className="fl-card" data-reveal>
                    <span className="fl-card__icon" aria-hidden="true"><Glyph /></span>
                    <h3>{name}</h3>
                    <p>{body}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="fl-section" aria-labelledby="fl-principles-title">
          <div className="guard-wrap">
            <header className="fl-head">
              <p className="home-kicker" data-reveal>{copy.principles.kicker}</p>
              <h2 id="fl-principles-title" className="home-title" data-reveal style={title(copy.principles.title)}>{copy.principles.title}</h2>
            </header>
            <ul className="fl-principles">
              {copy.principles.items.map(([name, body]) => (
                <li key={name} data-reveal>
                  <h3>{name}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="fl-section fl-section--tint" aria-labelledby="fl-steps-title">
          <div className="guard-wrap">
            <header className="fl-head">
              <p className="home-kicker" data-reveal>{copy.steps.kicker}</p>
              <h2 id="fl-steps-title" className="home-title" data-reveal style={title(copy.steps.title)}>{copy.steps.title}</h2>
            </header>
            <ol className="fl-steps">
              {copy.steps.items.map(([name, body], index) => (
                <li key={name} data-reveal>
                  <span className="fl-steps__index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <h3>{name}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="fl-cta" aria-labelledby="fl-cta-title">
          <div className="guard-wrap fl-cta__inner" data-reveal>
            <h2 id="fl-cta-title">{copy.cta.title}</h2>
            <p>{copy.cta.body}</p>
            <a className="guard-button" href={FLEET_CONTACT}>{copy.cta.button}</a>
          </div>
        </section>
      </main>
      <GuardFooter />
    </div>
  );
}
