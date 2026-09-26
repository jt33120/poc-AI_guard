"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { ActivityIcon, CodeIcon, ServerIcon, SlidersIcon, TerminalIcon } from "@/components/home/icons";
import { useT } from "@/lib/i18n";
import { HOSTS } from "./hosts";
import { SECRET_GUARD_COPY } from "./secret-guard-copy";

const LAYER_ICONS = [CodeIcon, ActivityIcon, SlidersIcon];

/**
 * Le schéma : le prompt part du poste, traverse le filtre, et n'arrive au serveur
 * qu'expurgé. Le jeton d'exemple n'a que son préfixe : aucune valeur réelle.
 */
export function SgFlow() {
  const { lang } = useT();
  const copy = SECRET_GUARD_COPY[lang].flow;
  return (
    <section id="fonctionnement" className="sg-flow" aria-labelledby="sg-flow-title">
      <div className="guard-wrap">
        <header className="sg-head">
          <p className="home-kicker" data-reveal>{copy.kicker}</p>
          <h2 id="sg-flow-title" className="home-title" data-reveal style={{ "--chars": copy.title.length } as CSSProperties}>{copy.title}</h2>
        </header>

        <div className="sg-flow__diagram" data-reveal>
          <article className="sg-node">
            <p className="sg-node__label"><TerminalIcon /> {copy.prompt}</p>
            <p className="sg-code">{copy.promptLine} <code>Bearer <mark data-risk>ghp_8f3K••••••••</mark></code></p>
          </article>

          <div className="sg-pipe" data-tone="risk" aria-hidden="true"><span /></div>

          <article className="sg-node sg-node--guard">
            <p className="sg-node__label">
              {/* The xSOM mark is served as a file, like in the brand block (see brand.tsx). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/xsom-mark.svg" alt="" width={22} height={22} /> {copy.guard}
            </p>
            <ol className="sg-layers">
              {copy.layers.map(([title, detail], index) => {
                const Glyph = LAYER_ICONS[index];
                return (
                  <li key={title}>
                    <span className="sg-layers__icon"><Glyph /></span>
                    <span>
                      <strong>{title}</strong>
                      {index === 2 && <em>{copy.team}</em>}
                      <small>{detail}</small>
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="sg-node__foot">{copy.footnote}</p>
          </article>

          <div className="sg-pipe" data-tone="safe" aria-hidden="true"><span /></div>

          <article className="sg-node">
            <p className="sg-node__label"><ServerIcon /> {copy.server}</p>
            <ul className="sg-node__hosts">
              {HOSTS.map((host) => (
                <li key={host.id} className="sg-logo" data-host={host.id}>
                  <Image src={host.logo} alt={host.name} width={40} height={40} />
                </li>
              ))}
            </ul>
            <p className="sg-code" data-safe>{copy.sent} <code>Bearer <mark>{copy.masked}</mark></code></p>
          </article>
        </div>
      </div>
    </section>
  );
}
