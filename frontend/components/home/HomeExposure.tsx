"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { GUARD_HOME_COPY, GUARD_UNIVERSES, type GuardUniverse } from "@/components/guard-home-copy";
import { THREAT_GLOSSARY, type GlossaryUse } from "@/lib/threat-glossary";
import { visualForThreat } from "@/lib/threat-visuals";
import { useT } from "@/lib/i18n";
import campus from "@/public/signal-media/ai-guard-campus-v3.png";
import { HOME_COPY } from "./home-copy";

/** Chaque équipe, son usage dans le glossaire et les trois fiches qui la concernent le plus. */
const TEAM_RISKS: Record<GuardUniverse, { use: GlossaryUse; ids: readonly string[] }> = {
  people: { use: "workplace", ids: ["fuite-de-donnees", "shadow-ai", "hallucinations"] },
  development: { use: "development", ids: ["fuite-de-secrets", "sorties-non-maitrisees", "autonomie-excessive"] },
  data: { use: "models", ids: ["empoisonnement", "modele-piege", "vol-de-modele"] },
};

/**
 * Où se tient chaque équipe dans l'illustration (métier à gauche, développement au
 * centre, modèles à droite), et de quel côté s'ouvre son panneau pour ne pas la cacher.
 */
const TEAM_LAYOUT: Record<GuardUniverse, { focus: string; panel: "left" | "right" }> = {
  people: { focus: "0%", panel: "right" },
  development: { focus: "50%", panel: "right" },
  data: { focus: "100%", panel: "left" },
};

/**
 * Les équipes, sur l'illustration du campus en pleine section. Un onglet (ou un
 * repère sur l'image) rapproche l'image de l'équipe et ouvre son panneau ; le même
 * onglet, ou Échap, revient à la vue d'ensemble.
 */
export function HomeExposure() {
  const { lang } = useT();
  const home = GUARD_HOME_COPY[lang];
  const copy = HOME_COPY[lang].exposure;
  const [active, setActive] = useState<GuardUniverse | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const selected = active ? home.universes[active] : null;
  const threats = active ? TEAM_RISKS[active].ids.flatMap((id) => THREAT_GLOSSARY.filter((entry) => entry.id === id)) : [];
  const shown = THREAT_GLOSSARY.find((entry) => entry.id === preview);
  const toggle = (team: GuardUniverse) => setActive((current) => (current === team ? null : team));

  useEffect(() => {
    if (!active) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !dialog.current?.open) setActive(null); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [active]);

  useEffect(() => {
    if (!preview) return;
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [preview]);

  return (
    <section
      id="usages"
      className="home-campus"
      aria-labelledby="usages-heading"
      data-active={active ?? undefined}
      data-panel={active ? TEAM_LAYOUT[active].panel : undefined}
      style={{ "--focus-x": active ? TEAM_LAYOUT[active].focus : "50%" } as CSSProperties}
    >
      <div className="home-campus__art">
        <Image src={campus} alt={home.imageAlt} fill sizes="100vw" placeholder="blur" className="home-campus__image" />
        <div className="home-campus__spots" aria-hidden="true">
          {GUARD_UNIVERSES.map((team) => (
            <button key={team} type="button" tabIndex={-1} data-zone={team} data-on={team === active} onClick={() => toggle(team)}>
              <span>{team === active ? "−" : "+"}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="home-campus__shade" aria-hidden="true" />

      <div className="guard-wrap home-campus__head">
        <p className="home-kicker" data-reveal>{copy.kicker}</p>
        <h2 id="usages-heading" className="home-title" data-reveal style={{ "--chars": home.usagesTitle.length } as CSSProperties}>
          {home.usagesTitle}
        </h2>
      </div>

      <aside id="campus-detail" className="home-campus__panel" hidden={!selected} aria-live="polite" aria-labelledby="campus-detail-title">
        {selected && active && <>
          <header>
            <p className="home-campus__marker">{selected.marker} · {selected.subtitle}</p>
            <h3 id="campus-detail-title">{selected.name}</h3>
            <button type="button" className="home-campus__close" onClick={() => setActive(null)} aria-label={copy.close}>×</button>
          </header>
          <p className="home-campus__daily">{selected.daily}</p>
          <div className="home-campus__lists">
            <div><h4>{home.everyday}</h4><ul>{selected.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div>
            <div><h4>{home.controlsTitle}</h4><ul>{selected.safeguards.map((item) => <li key={item}>{item}</li>)}</ul></div>
          </div>
          <h4>{copy.risks}</h4>
          <div className="home-campus__threats">
            {threats.map((entry) => (
              <button key={entry.id} type="button" onClick={() => setPreview(entry.id)} aria-label={`${copy.enlarge} : ${entry.copy[lang].title}`}>
                {/* The glossary illustrations are served as they are, like on /menaces. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={visualForThreat(entry.id) ?? ""} alt="" width={200} height={200} loading="lazy" />
                <span>{entry.copy[lang].title}</span>
              </button>
            ))}
          </div>
          <Link
            className="home-campus__more"
            href={`/menaces?use=${TEAM_RISKS[active].use}#definitions`}
            aria-label={`${home.exploreTeamRisks} : ${selected.name}`}
          >
            {home.exploreTeamRisks} <span aria-hidden="true">↗</span>
          </Link>
        </>}
      </aside>

      <div className="home-campus__tabs" role="group" aria-label={copy.teams}>
        {GUARD_UNIVERSES.map((team) => {
          const universe = home.universes[team];
          return (
            <button key={team} type="button" aria-pressed={team === active} aria-controls="campus-detail" onClick={() => toggle(team)}>
              <span className="home-campus__tab-marker">{universe.marker}</span>{" "}
              <span className="home-campus__tab-name">{universe.name}</span>{" "}
              <span className="home-campus__tab-sub">{universe.subtitle}</span>
            </button>
          );
        })}
      </div>

      <dialog ref={dialog} className="home-preview" aria-labelledby="home-preview-title" onClose={() => setPreview(null)} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
        {shown && <div className="home-preview__inner">
          <header>
            <h3 id="home-preview-title">{shown.copy[lang].title}</h3>
            <button type="button" onClick={() => dialog.current?.close()} aria-label={copy.closePreview}>×</button>
          </header>
          <div className="home-preview__body">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={visualForThreat(shown.id) ?? ""} alt={shown.copy[lang].title} width={960} height={960} />
            <div>
              <h4>{copy.attack}</h4><p>{shown.copy[lang].attack}</p>
              <h4>{copy.mitigation}</h4><p>{shown.copy[lang].mitigation}</p>
              <Link href={`/menaces#${shown.id}`} onClick={() => dialog.current?.close()}>{copy.fullSheet} <span aria-hidden="true">↗</span></Link>
            </div>
          </div>
        </div>}
      </dialog>
    </section>
  );
}
