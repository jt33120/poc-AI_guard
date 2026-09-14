"use client";

import Link from "next/link";
import { useState } from "react";

import { Wordmark, XsomMark } from "@/components/brand";
import { SignalPreferences } from "@/design-system/react";
import { LanguageToggle, useT } from "@/lib/i18n";
import {
  GLOSSARY_COPY,
  GLOSSARY_USES,
  THREAT_GLOSSARY,
  type GlossaryUse,
} from "@/lib/threat-glossary";

function normalise(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function ThreatGlossary() {
  const { lang } = useT();
  const copy = GLOSSARY_COPY[lang];
  const [use, setUse] = useState<GlossaryUse | "all">("all");
  const [query, setQuery] = useState("");
  const words = normalise(query).trim().split(/\s+/).filter(Boolean);
  const entries = THREAT_GLOSSARY.filter((entry) => {
    if (use !== "all" && !entry.uses.includes(use)) return false;
    const searchText = normalise([
      ...Object.values(entry.copy[lang]),
      entry.source.code,
      entry.source.title,
      ...entry.uses.map((id) => copy.uses[id]),
    ].join(" "));
    return words.every((word) => searchText.includes(word));
  });

  function resetFilters() {
    setQuery("");
    setUse("all");
  }

  return (
    <div className="guard-landing guard-glossary">
      <a className="guard-glossary__skip" href="#definitions">{copy.skip}</a>
      <header className="guard-header">
        <div className="guard-wrap guard-header__inner">
          <Link href="/" className="brand" aria-label={`xSOM · ${copy.home}`}>
            <XsomMark />
            <Wordmark />
          </Link>
          <nav aria-label={copy.mainNav}>
            <Link href="/#usages">{copy.usesNav}</Link>
            <Link href="/#produits">{copy.productsNav}</Link>
            <LanguageToggle />
            <Link href="/saas" className="guard-button guard-button--small">
              {copy.selfService}<span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="guard-wrap guard-glossary__hero" aria-labelledby="glossary-heading">
          <Link href="/" className="guard-glossary__back"><span aria-hidden="true">←</span> {copy.home}</Link>
          <p className="guard-kicker">{copy.kicker}</p>
          <h1 id="glossary-heading">{copy.title}</h1>
          <p className="guard-glossary__intro">{copy.intro}</p>
        </section>

        <section id="definitions" className="guard-wrap guard-glossary__content" aria-labelledby="glossary-heading" tabIndex={-1}>
          <div className="guard-glossary__toolbar">
            <div className="guard-glossary__search">
              <label htmlFor="threat-search">{copy.search}</label>
              <div>
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5" /><path d="m15 15 5 5" /></svg>
                <input
                  id="threat-search"
                  type="search"
                  autoComplete="off"
                  placeholder={copy.placeholder}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-controls="threat-definitions"
                />
              </div>
            </div>
            <div className="guard-glossary__filters" role="group" aria-label={copy.filter}>
              {(["all", ...GLOSSARY_USES] as const).map((id) => (
                <button key={id} type="button" aria-pressed={use === id} aria-controls="threat-definitions" onClick={() => setUse(id)}>
                  {id === "all" ? copy.all : copy.uses[id]}
                </button>
              ))}
            </div>
          </div>

          <div className="guard-glossary__results-heading">
            <p role="status" aria-atomic="true">{entries.length} {entries.length === 1 ? copy.countOne : copy.count}</p>
            {(query || use !== "all") && <button type="button" onClick={resetFilters}>{copy.reset}</button>}
          </div>

          <div id="threat-definitions">
            {entries.length ? (
              <ul className="guard-glossary__grid">
                {entries.map((entry) => {
                  const definition = entry.copy[lang];
                  return (
                    <li key={entry.id}>
                      <article id={entry.id} className="guard-glossary__card" aria-labelledby={`${entry.id}-title`}>
                        <div className="guard-glossary__tags">
                          {entry.uses.map((id) => <span key={id}>{copy.uses[id]}</span>)}
                        </div>
                        <h2 id={`${entry.id}-title`}>{definition.title}</h2>
                        <p className="guard-glossary__definition">{definition.definition}</p>
                        <div className="guard-glossary__example">
                          <h3>{copy.example}</h3>
                          <p>{definition.example}</p>
                        </div>
                        <div className="guard-glossary__reflex">
                          <h3>{copy.reflex}</h3>
                          <p>{definition.reflex}</p>
                        </div>
                        <a className="guard-glossary__source" href={entry.source.href} target="_blank" rel="noreferrer" aria-label={`${copy.reference} ${entry.source.code} — ${entry.source.title}`}>
                          {copy.reference} · {entry.source.code}<span aria-hidden="true">↗</span>
                        </a>
                      </article>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="guard-glossary__empty">
                <h2>{copy.emptyTitle}</h2>
                <p>{copy.emptyText}</p>
                <button className="guard-button guard-button--small" type="button" onClick={resetFilters}>{copy.reset}</button>
              </div>
            )}
          </div>

          <p className="guard-glossary__scope">{copy.scope} <Link href="/evidence">{copy.deeper} ↗</Link></p>
          <aside className="guard-glossary__next" aria-labelledby="glossary-next-heading">
            <div>
              <h2 id="glossary-next-heading">{copy.nextTitle}</h2>
              <p>{copy.nextText}</p>
            </div>
            <Link href="/#produits" className="guard-button">{copy.nextLink}<span aria-hidden="true">↗</span></Link>
          </aside>
        </section>
      </main>

      <footer className="guard-footer">
        <div className="guard-wrap">
          <Link href="/" className="brand" aria-label={`xSOM · ${copy.home}`}><XsomMark /><Wordmark /></Link>
          <p>{copy.footer}</p>
          <a href="https://www.xsom.fr" target="_blank" rel="noreferrer">{copy.cabinet} ↗</a>
          <details>
            <summary>{copy.display}</summary>
            <SignalPreferences lang={lang} />
          </details>
        </div>
      </footer>
    </div>
  );
}
