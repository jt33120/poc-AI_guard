"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, type ReactNode } from "react";

import { Wordmark, XsomMark } from "@/components/brand";
import { Diagramme, DiagrammeDefs } from "@/components/Diagramme";
import { GuardNav } from "@/components/GuardNav";
import { SignalPreferences } from "@/design-system/react";
import { figureDeFiche } from "@/lib/glossary-figures";
import { useT } from "@/lib/i18n";
import type { Lang } from "@/lib/strings";
import {
  GLOSSARY_CATEGORIES,
  GLOSSARY_COPY,
  GLOSSARY_COVERAGES,
  GLOSSARY_IMPACTS,
  GLOSSARY_STATUSES,
  GLOSSARY_SURFACES,
  GLOSSARY_USES,
  OWASP,
  THREAT_GLOSSARY,
  type GlossaryCategory,
  type GlossaryCoverage,
  type GlossaryEntry,
  type GlossaryImpact,
  type GlossaryStatus,
  type GlossarySurface,
  type GlossaryTool,
  type GlossaryUse,
} from "@/lib/threat-glossary";

type Copy = (typeof GLOSSARY_COPY)[Lang];

type Filters = {
  use: GlossaryUse | "all";
  coverage: GlossaryCoverage | "all";
  category: GlossaryCategory | "all";
  surface: GlossarySurface | "all";
  impact: GlossaryImpact | "all";
  status: GlossaryStatus | "all";
};
type Facet = keyof Filters;

const NO_FILTERS: Filters = {
  use: "all",
  coverage: "all",
  category: "all",
  surface: "all",
  impact: "all",
  status: "all",
};

const SORTS = ["category", "risk", "coverage", "name"] as const;
type Sort = (typeof SORTS)[number];

const COLUMNS = ["threat", "attack", "mitigation", "tools", "status", "guard"] as const;

function normalise(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function toolLabel(tool: GlossaryTool, lang: Lang) {
  return typeof tool === "string" ? tool : tool[lang];
}

function matchesFacets(entry: GlossaryEntry, filters: Filters) {
  return (
    (filters.use === "all" || entry.uses.includes(filters.use)) &&
    (filters.coverage === "all" || entry.coverage === filters.coverage) &&
    (filters.category === "all" || entry.category === filters.category) &&
    (filters.surface === "all" || entry.surface === filters.surface) &&
    (filters.impact === "all" || entry.impact === filters.impact) &&
    (filters.status === "all" || entry.status === filters.status)
  );
}

/** Tout ce que le lecteur voit d'une ligne, détail compris, dans sa langue. */
function searchText(entry: GlossaryEntry, lang: Lang, copy: Copy) {
  const text = entry.copy[lang];
  const explainer = entry.explainer?.[lang];
  return normalise([
    text.title,
    text.attack,
    text.mitigation,
    text.guard,
    text.statusNote ?? "",
    ...(explainer ? [explainer.definition, explainer.example, explainer.reflex] : []),
    ...entry.tools.map((tool) => toolLabel(tool, lang)),
    entry.owasp ? `${entry.owasp} ${OWASP[entry.owasp].title}` : "",
    copy.categories[entry.category],
    copy.surfaces[entry.surface],
    copy.impacts[entry.impact],
    copy.statuses[entry.status],
    copy.coverage[entry.coverage],
    ...entry.uses.map((id) => copy.uses[id]),
  ].join(" "));
}

/** `Array.prototype.sort` est stable : à égalité, l'ordre éditorial du fichier tient. */
function sortEntries(entries: GlossaryEntry[], sort: Sort, lang: Lang) {
  const sorted = [...entries];
  if (sort === "risk") sorted.sort((a, b) => GLOSSARY_STATUSES.indexOf(a.status) - GLOSSARY_STATUSES.indexOf(b.status));
  if (sort === "coverage") sorted.sort((a, b) => GLOSSARY_COVERAGES.indexOf(a.coverage) - GLOSSARY_COVERAGES.indexOf(b.coverage));
  if (sort === "name") sorted.sort((a, b) => a.copy[lang].title.localeCompare(b.copy[lang].title, lang));
  return sorted;
}

export function ThreatGlossary() {
  const { lang } = useT();
  const copy = GLOSSARY_COPY[lang];
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort>("category");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  // Un lien profond `/menaces#<id>` ouvre la ligne qu'il vise : le navigateur y
  // défile déjà, il reste à montrer son détail.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (THREAT_GLOSSARY.some((entry) => entry.id === id)) setOpen(new Set([id]));
  }, []);

  const words = normalise(query).trim().split(/\s+/).filter(Boolean);
  const searched = THREAT_GLOSSARY.filter((entry) => {
    const text = searchText(entry, lang, copy);
    return words.every((word) => text.includes(word));
  });
  const entries = searched.filter((entry) => matchesFacets(entry, filters));
  const grouped = sort === "category";
  const groups = grouped
    ? GLOSSARY_CATEGORIES.map((id) => ({ id, entries: entries.filter((entry) => entry.category === id) }))
        .filter((group) => group.entries.length > 0)
    : [{ id: "all" as const, entries: sortEntries(entries, sort, lang) }];
  const filtered = query !== "" || Object.values(filters).some((value) => value !== "all");

  /** Combien de lignes resteraient si cette facette prenait cette valeur, les autres filtres tenant. */
  function countWith(facet: Facet, value: string) {
    const next = { ...filters, [facet]: value } as Filters;
    return searched.filter((entry) => matchesFacets(entry, next)).length;
  }

  function setFacet(facet: Facet, value: string) {
    setFilters((current) => ({ ...current, [facet]: value }));
  }

  function resetFilters() {
    setQuery("");
    setFilters(NO_FILTERS);
  }

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const coverageCounts = GLOSSARY_COVERAGES.map((id) => ({ id, count: countWith("coverage", id) }));

  return (
    <div className="guard-landing guard-glossary">
      <a className="guard-glossary__skip" href="#definitions">{copy.skip}</a>
      <header className="guard-header">
        <div className="guard-wrap guard-header__inner">
          <Link href="/" className="brand" aria-label={`xSOM · ${copy.home}`}>
            <XsomMark />
            <Wordmark />
          </Link>
          <GuardNav />
        </div>
      </header>

      <main>
        <section className="guard-wrap guard-glossary__hero reveal" aria-labelledby="glossary-heading">
          <Link href="/" className="guard-glossary__back"><span aria-hidden="true">←</span> {copy.home}</Link>
          <p className="guard-kicker">{copy.kicker}</p>
          <h1 id="glossary-heading">{copy.title}</h1>
          <p className="guard-glossary__intro">{copy.intro}</p>
        </section>

        <section id="definitions" className="guard-wrap guard-glossary__content" aria-labelledby="glossary-table-heading" tabIndex={-1}>
          <h2 id="glossary-table-heading" className="guard-glossary__sr">{copy.tableHeading}</h2>
          <DiagrammeDefs />
          <div className="guard-glossary__toolbar reveal" data-delay="1">
            <div className="guard-glossary__toolbar-top">
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
              <SelectField id="threat-sort" label={copy.sort} value={sort} onChange={(value) => setSort(value as Sort)}>
                {SORTS.map((id) => <option key={id} value={id}>{copy.sorts[id]}</option>)}
              </SelectField>
            </div>

            <div className="guard-glossary__facet">
              <p id="threat-use-label" className="guard-glossary__facet-label">{copy.filter}</p>
              <div className="guard-glossary__filters" role="group" aria-labelledby="threat-use-label">
                {(["all", ...GLOSSARY_USES] as const).map((id) => (
                  <FilterChip key={id} pressed={filters.use === id} count={countWith("use", id)} onClick={() => setFacet("use", id)}>
                    {id === "all" ? copy.all : copy.uses[id]}
                  </FilterChip>
                ))}
              </div>
            </div>

            <div className="guard-glossary__facet">
              <p id="threat-coverage-label" className="guard-glossary__facet-label">{copy.coverageFilter}</p>
              <CoverageMeter counts={coverageCounts} selected={filters.coverage} copy={copy} />
              <div className="guard-glossary__filters" role="group" aria-labelledby="threat-coverage-label">
                <FilterChip pressed={filters.coverage === "all"} count={countWith("coverage", "all")} onClick={() => setFacet("coverage", "all")}>
                  {copy.coverageAll}
                </FilterChip>
                {coverageCounts.map(({ id, count }) => (
                  <FilterChip key={id} pressed={filters.coverage === id} count={count} onClick={() => setFacet("coverage", id)}>
                    <CoverageIcon coverage={id} />
                    {copy.coverage[id]}
                  </FilterChip>
                ))}
              </div>
              <p className="guard-glossary__legend">{copy.coverageLegend}</p>
            </div>

            <div className="guard-glossary__selects">
              <FacetSelect id="threat-category" label={copy.category} all={copy.categoryAll} options={GLOSSARY_CATEGORIES} labels={copy.categories} value={filters.category} count={(value) => countWith("category", value)} onChange={(value) => setFacet("category", value)} />
              <FacetSelect id="threat-surface" label={copy.surface} all={copy.surfaceAll} options={GLOSSARY_SURFACES} labels={copy.surfaces} value={filters.surface} count={(value) => countWith("surface", value)} onChange={(value) => setFacet("surface", value)} />
              <FacetSelect id="threat-impact" label={copy.impact} all={copy.impactAll} options={GLOSSARY_IMPACTS} labels={copy.impacts} value={filters.impact} count={(value) => countWith("impact", value)} onChange={(value) => setFacet("impact", value)} />
              <FacetSelect id="threat-status" label={copy.status} all={copy.statusAll} options={GLOSSARY_STATUSES} labels={copy.statuses} value={filters.status} count={(value) => countWith("status", value)} onChange={(value) => setFacet("status", value)} />
            </div>
          </div>

          <div className="guard-glossary__results-heading">
            <p role="status" aria-atomic="true">
              {entries.length} {entries.length === 1 ? copy.countOne : copy.count} {copy.of} {THREAT_GLOSSARY.length}
            </p>
            {filtered && <button type="button" onClick={resetFilters}>{copy.reset}</button>}
          </div>

          <div id="threat-definitions">
            {entries.length ? (
              <table className="guard-glossary__table">
                <caption className="guard-glossary__sr">{copy.caption}</caption>
                <colgroup>
                  {COLUMNS.map((id) => <col key={id} className={`guard-glossary__col--${id}`} />)}
                </colgroup>
                <thead>
                  <tr>
                    {COLUMNS.map((id) => <th key={id} scope="col">{copy.columns[id]}</th>)}
                  </tr>
                </thead>
                {groups.map((group) => (
                  <tbody key={group.id}>
                    {group.id !== "all" && (
                      <tr className="guard-glossary__group">
                        <th scope="colgroup" colSpan={COLUMNS.length}>
                          {copy.categories[group.id]} <span>{group.entries.length}</span>
                        </th>
                      </tr>
                    )}
                    {group.entries.map((entry) => (
                      <ThreatRows
                        key={entry.id}
                        entry={entry}
                        lang={lang}
                        copy={copy}
                        showCategory={!grouped}
                        open={open.has(entry.id)}
                        onToggle={toggle}
                      />
                    ))}
                  </tbody>
                ))}
              </table>
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
            <Link href="/produits" className="guard-button">{copy.nextLink}<span aria-hidden="true">↗</span></Link>
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

function FilterChip({
  pressed,
  count,
  onClick,
  children,
}: {
  pressed: boolean;
  count: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-pressed={pressed} aria-controls="threat-definitions" onClick={onClick}>
      {children}
      <span className="guard-glossary__count" aria-hidden="true">{count}</span>
    </button>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="guard-glossary__select">
      <label htmlFor={id}>{label}</label>
      <div>
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-controls="threat-definitions">
          {children}
        </select>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
      </div>
    </div>
  );
}

/** Une facette en liste déroulante ; une valeur qui viderait le tableau est grisée. */
function FacetSelect<T extends string>({
  id,
  label,
  all,
  options,
  labels,
  value,
  count,
  onChange,
}: {
  id: string;
  label: string;
  all: string;
  options: readonly T[];
  labels: Readonly<Record<T, string>>;
  value: T | "all";
  count: (value: T | "all") => number;
  onChange: (value: T | "all") => void;
}) {
  return (
    <SelectField id={id} label={label} value={value} onChange={(next) => onChange(next as T | "all")}>
      <option value="all">{all} ({count("all")})</option>
      {options.map((option) => {
        const n = count(option);
        return (
          <option key={option} value={option} disabled={n === 0 && option !== value}>
            {labels[option]} ({n})
          </option>
        );
      })}
    </SelectField>
  );
}

/**
 * La répartition de la couverture sur les lignes que les autres filtres laissent.
 *
 * Décorative pour les technologies d'assistance : les boutons qui la suivent portent
 * les mêmes libellés, et le statut annonce le nombre de lignes affichées.
 */
function CoverageMeter({
  counts,
  selected,
  copy,
}: {
  counts: readonly { id: GlossaryCoverage; count: number }[];
  selected: GlossaryCoverage | "all";
  copy: Copy;
}) {
  return (
    <div className="guard-glossary__meter" data-selected={selected === "all" ? undefined : selected} aria-hidden="true">
      {counts.filter(({ count }) => count > 0).map(({ id, count }) => (
        <span
          key={id}
          data-coverage={id}
          data-active={selected === id ? "" : undefined}
          style={{ flexGrow: count }}
          title={`${copy.coverage[id]} · ${count}`}
        />
      ))}
    </div>
  );
}

function CoverageIcon({ coverage }: { coverage: GlossaryCoverage }) {
  return (
    <svg className="guard-glossary__coverage-icon" data-coverage={coverage} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" />
      {coverage === "yes" && <path d="m4.8 8.2 2.1 2.1 4.3-4.6" />}
      {coverage === "partial" && <path className="guard-glossary__coverage-half" d="M8 1a7 7 0 0 1 0 14z" />}
      {coverage === "no" && <path d="m5.5 5.5 5 5m0-5-5 5" />}
    </svg>
  );
}

function ThreatRows({
  entry,
  lang,
  copy,
  showCategory,
  open,
  onToggle,
}: {
  entry: GlossaryEntry;
  lang: Lang;
  copy: Copy;
  showCategory: boolean;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  const text = entry.copy[lang];
  const detailsId = `${entry.id}-details`;
  return (
    <Fragment>
      <tr id={entry.id} className="guard-glossary__row" data-open={open ? "" : undefined}>
        <th scope="row" className="guard-glossary__threat">
          {showCategory && <span className="guard-glossary__kicker">{copy.categories[entry.category]}</span>}
          <button type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => onToggle(entry.id)}>
            <span>{text.title}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
          </button>
          {entry.owasp && <span className="guard-glossary__code">{entry.owasp}:2025</span>}
        </th>
        <td data-cell="attack" data-label={copy.columns.attack}>{text.attack}</td>
        <td data-cell="mitigation" data-label={copy.columns.mitigation}>{text.mitigation}</td>
        <td data-cell="tools" data-label={copy.columns.tools}>
          <ul className="guard-glossary__tools">
            {entry.tools.map((tool) => (
              <li key={toolLabel(tool, "en")} data-generic={typeof tool === "string" ? undefined : ""}>{toolLabel(tool, lang)}</li>
            ))}
          </ul>
        </td>
        <td data-cell="status" data-label={copy.columns.status}>
          <span className="guard-glossary__status" data-status={entry.status}>
            <span className="guard-glossary__dot" aria-hidden="true" />
            {copy.statuses[entry.status]}
          </span>
          {text.statusNote && <span className="guard-glossary__note">{text.statusNote}</span>}
        </td>
        <td data-cell="guard" data-label={copy.columns.guard}>
          <span className="guard-glossary__coverage" data-coverage={entry.coverage}>
            <CoverageIcon coverage={entry.coverage} />
            {copy.coverage[entry.coverage]}
          </span>
        </td>
      </tr>
      <tr id={detailsId} className="guard-glossary__details" hidden={!open}>
        <td colSpan={COLUMNS.length}>{open && <ThreatDetails entry={entry} lang={lang} copy={copy} />}</td>
      </tr>
    </Fragment>
  );
}

function ThreatDetails({ entry, lang, copy }: { entry: GlossaryEntry; lang: Lang; copy: Copy }) {
  const text = entry.copy[lang];
  const explainer = entry.explainer?.[lang];
  const figure = figureDeFiche(entry.id);
  const owasp = entry.owasp ? OWASP[entry.owasp] : undefined;
  return (
    <div className="guard-glossary__detail">
      {explainer && (
        <div className="guard-glossary__detail-column">
          <div>
            <h3>{copy.definition}</h3>
            <p className="guard-glossary__definition">{explainer.definition}</p>
          </div>
          <div className="guard-glossary__example">
            <h3>{copy.example}</h3>
            <p>{explainer.example}</p>
          </div>
          <div>
            <h3>{copy.reflex}</h3>
            <p>{explainer.reflex}</p>
          </div>
        </div>
      )}
      <div className="guard-glossary__detail-column">
        <div className="guard-glossary__guard" data-coverage={entry.coverage}>
          <h3>
            <CoverageIcon coverage={entry.coverage} />
            {copy.guardHeading} · {copy.coverage[entry.coverage]}
          </h3>
          <p>{text.guard}</p>
          {entry.releve && <Link href="/evidence#menaces">{copy.proof} · {entry.releve} <span aria-hidden="true">↗</span></Link>}
        </div>
        <dl className="guard-glossary__facets">
          <div>
            <dt>{copy.usesHeading}</dt>
            <dd className="guard-glossary__tags">{entry.uses.map((id) => <span key={id}>{copy.uses[id]}</span>)}</dd>
          </div>
          <div>
            <dt>{copy.surface}</dt>
            <dd>{copy.surfaces[entry.surface]}</dd>
          </div>
          <div>
            <dt>{copy.impact}</dt>
            <dd>{copy.impacts[entry.impact]}</dd>
          </div>
        </dl>
        {entry.owasp && owasp && (
          <a className="guard-glossary__source" href={owasp.href} target="_blank" rel="noreferrer" aria-label={`${copy.reference} ${entry.owasp}:2025 — ${owasp.title}`}>
            {copy.reference} · {entry.owasp}:2025 — {owasp.title}<span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
      {figure && (
        <div className="guard-glossary__figure">
          <Diagramme corps={figure} ouvert />
        </div>
      )}
    </div>
  );
}
