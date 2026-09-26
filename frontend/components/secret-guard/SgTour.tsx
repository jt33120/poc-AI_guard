"use client";

import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useT } from "@/lib/i18n";
import tooltip from "@/public/signal-media/secret-guard-tooltip.png";
import { SECRET_GUARD_COPY, type TooltipControl } from "./secret-guard-copy";
import TOOLTIP_MAP from "./tooltip-map.json";

/** Légendes de gauche et de droite, chacune dans l'ordre vertical de son bouton. */
const LEFT: readonly TooltipControl[] = ["dashboard", "observe", "effects"];
const RIGHT: readonly TooltipControl[] = ["redact", "block", "purge", "statusbar"];
/** Numéros dans l'ordre de lecture du panneau, du haut vers le bas. */
const ORDER: readonly TooltipControl[] = ["dashboard", "observe", "redact", "block", "effects", "purge", "statusbar"];
/** Les tuiles de niveau sont côte à côte : leur flèche arrive par le haut. */
const TILES = new Set<TooltipControl>(["observe", "redact", "block"]);

interface Line {
  readonly id: TooltipControl;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

function anchor(id: TooltipControl, left: boolean): { x: number; y: number } {
  const spot = TOOLTIP_MAP.spots[id];
  if (TILES.has(id)) return { x: spot.x + spot.w / 2, y: spot.y };
  return { x: left ? spot.x : spot.x + spot.w, y: spot.y + spot.h / 2 };
}

/**
 * Le vrai panneau de l'extension, rendu depuis son code (`render-secret-guard-tooltip.mjs`),
 * entouré de ses légendes. Chaque légende pointe son bouton ; survoler l'un ou l'autre
 * déplie l'explication. Les positions viennent de la carte relevée au rendu, jamais
 * d'un calage à l'œil.
 */
export function SgTour() {
  const { lang } = useT();
  const copy = SECRET_GUARD_COPY[lang].tour;
  const [active, setActive] = useState<TooltipControl>("redact");
  const [lines, setLines] = useState<readonly Line[]>([]);
  const figure = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLDivElement>(null);
  const callouts = useRef(new Map<TooltipControl, HTMLButtonElement>());

  const measure = useCallback(() => {
    const box = figure.current?.getBoundingClientRect();
    const image = picture.current?.getBoundingClientRect();
    if (!box || !image) return;
    const next: Line[] = [];
    for (const id of [...LEFT, ...RIGHT]) {
      const callout = callouts.current.get(id)?.getBoundingClientRect();
      if (!callout || callout.width === 0) continue;
      const left = LEFT.includes(id);
      const target = anchor(id, left);
      next.push({
        id,
        x1: (left ? callout.right : callout.left) - box.left,
        y1: callout.top + 22 - box.top,
        x2: image.left + target.x * image.width - box.left,
        y2: image.top + target.y * image.height - box.top,
      });
    }
    setLines(next);
  }, []);

  useLayoutEffect(measure, [measure, active, lang]);
  useEffect(() => {
    const observer = new ResizeObserver(measure);
    if (figure.current) observer.observe(figure.current);
    return () => observer.disconnect();
  }, [measure]);

  const callout = (id: TooltipControl) => {
    const [name, text] = copy.controls[id];
    return (
      <li key={id} style={{ order: ORDER.indexOf(id) + 1 }}>
        <button
          ref={(element) => { if (element) callouts.current.set(id, element); else callouts.current.delete(id); }}
          type="button"
          className="sg-callout"
          aria-expanded={id === active}
          onMouseEnter={() => setActive(id)}
          onFocus={() => setActive(id)}
          onClick={() => setActive(id)}
        >
          <span className="sg-callout__head">
            <span className="sg-callout__num" aria-hidden="true">{ORDER.indexOf(id) + 1}</span>
            <strong>{name}</strong>
            {id === "redact" && <em>{copy.recommended}</em>}
          </span>
          <span className="sg-callout__text"><span>{text}</span></span>
        </button>
      </li>
    );
  };

  return (
    <section id="panneau" className="sg-tour" aria-labelledby="sg-tour-title">
      <div className="guard-wrap">
        <header className="sg-head">
          <p className="home-kicker" data-reveal>{copy.kicker}</p>
          <h2 id="sg-tour-title" className="home-title" data-reveal style={{ "--chars": copy.title.length } as CSSProperties}>{copy.title}</h2>
          <p className="sg-tour__hint" data-reveal>{copy.hint}</p>
        </header>

        <div ref={figure} className="sg-tour__figure" data-reveal>
          <svg className="sg-tour__lines" aria-hidden="true">
            {lines.map((line) => (
              <g key={line.id} data-on={line.id === active}>
                <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
                <circle cx={line.x2} cy={line.y2} r={4} />
              </g>
            ))}
          </svg>
          <ul className="sg-tour__callouts" data-side="left">{LEFT.map(callout)}</ul>
          <div ref={picture} className="sg-tour__picture">
            <Image src={tooltip} alt={copy.alt} sizes="(max-width: 900px) 92vw, 460px" placeholder="blur" onLoad={measure} />
            <div className="sg-tour__spots" aria-hidden="true">
              {ORDER.map((id, index) => {
                const spot = TOOLTIP_MAP.spots[id];
                return (
                  <span
                    key={id}
                    data-on={id === active}
                    style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, width: `${spot.w * 100}%`, height: `${spot.h * 100}%` }}
                    onMouseEnter={() => setActive(id)}
                  >
                    <b>{index + 1}</b>
                  </span>
                );
              })}
            </div>
          </div>
          <ul className="sg-tour__callouts" data-side="right">{RIGHT.map(callout)}</ul>
        </div>
      </div>
    </section>
  );
}
