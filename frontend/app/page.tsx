"use client";

import Link from "next/link";

import { ShieldMark } from "@/components/brand";
import { LanguageToggle, type StrKey, useT } from "@/lib/i18n";

const DEMO_MAILTO = "mailto:julian.talou@xsom.fr?subject=xSOM%20AI%20Guard%20—%20demo";

const STATS: [StrKey, StrKey][] = [
  ["land.stat.1.v", "land.stat.1.l"],
  ["land.stat.2.v", "land.stat.2.l"],
  ["land.stat.3.v", "land.stat.3.l"],
  ["land.stat.4.v", "land.stat.4.l"],
];

const STEPS: [StrKey, StrKey][] = [
  ["land.how.s1.t", "land.how.s1.b"],
  ["land.how.s2.t", "land.how.s2.b"],
  ["land.how.s3.t", "land.how.s3.b"],
];

const FEATURES: { t: StrKey; b: StrKey; icon: keyof typeof ICONS }[] = [
  { t: "land.feat.1.t", b: "land.feat.1.b", icon: "gate" },
  { t: "land.feat.2.t", b: "land.feat.2.b", icon: "user" },
  { t: "land.feat.3.t", b: "land.feat.3.b", icon: "lock" },
  { t: "land.feat.4.t", b: "land.feat.4.b", icon: "doc" },
  { t: "land.feat.5.t", b: "land.feat.5.b", icon: "cpu" },
  { t: "land.feat.6.t", b: "land.feat.6.b", icon: "layers" },
];

const WHO: [StrKey, StrKey][] = [
  ["land.who.1.t", "land.who.1.b"],
  ["land.who.2.t", "land.who.2.b"],
  ["land.who.3.t", "land.who.3.b"],
];

const ICONS = {
  gate: "M4 12h16M4 12l4-4M4 12l4 4M20 4v16",
  user: "M16 11l2 2 4-4M3 20a7 7 0 0114 0M10 3a4 4 0 100 8 4 4 0 000-8z",
  lock: "M6 11V8a6 6 0 1112 0v3M5 11h14v9H5z",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6",
  cpu: "M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M6 6h12v12H6z",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
} as const;

function FeatureIcon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function FlowArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6 rotate-90 text-brand-bright md:rotate-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export default function LandingPage() {
  const { t } = useT();
  return (
    <main className="relative">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-navy/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/15 text-brand-bright ring-1 ring-brand/30">
              <ShieldMark className="h-5 w-5" />
            </span>
            {/* Accessible name stays "xSOM AI Guard". */}
            <h1 className="text-[15px] font-bold tracking-tight">
              xSOM <span className="font-medium text-white/50">AI Guard</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <Link href="/login" className="btn btn-ghost hidden px-4 py-1.5 sm:inline-flex">
              {t("land.nav.signin")}
            </Link>
            <a href={DEMO_MAILTO} className="btn btn-primary px-4 py-1.5">
              {t("land.nav.demo")}
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-16 sm:pt-24">
        <div className="animate-fade-up">
          <span className="badge badge-blue">{t("land.hero.badge")}</span>
          <p className="mt-6 max-w-4xl text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl">
            {t("land.hero.title")}
          </p>
          <p className="muted mt-6 max-w-2xl text-lg leading-relaxed">{t("land.hero.sub")}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/login" className="btn btn-primary">
              {t("land.hero.cta")}
            </Link>
            <a href="#how" className="btn btn-ghost">
              {t("land.hero.cta2")}
            </a>
            <span className="muted ml-1 inline-flex items-center gap-1.5 text-sm">
              <ShieldMark className="h-4 w-4 text-brand-bright" />
              {t("land.hero.trust")}
            </span>
          </div>
        </div>

        {/* Stats band */}
        <div className="mt-14 grid grid-cols-2 gap-4 md:grid-cols-4">
          {STATS.map(([v, l]) => (
            <div key={v} className="card p-5">
              <div className="text-3xl font-extrabold tracking-tight text-brand-bright">{t(v)}</div>
              <div className="muted mt-1.5 text-sm leading-snug">{t(l)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="card p-7 sm:p-10">
          <span className="label text-brand-bright">{t("land.problem.kicker")}</span>
          <h2 className="mt-2 max-w-3xl text-2xl font-bold sm:text-3xl">{t("land.problem.title")}</h2>
          <p className="muted mt-4 max-w-3xl text-base leading-relaxed">{t("land.problem.body")}</p>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-12">
        <div className="text-center">
          <span className="label text-brand-bright">{t("land.how.kicker")}</span>
          <h2 className="mt-2 text-2xl font-bold sm:text-3xl">{t("land.how.title")}</h2>
        </div>

        {/* Diagram: agent → guard → tools */}
        <div className="mt-10 flex flex-col items-stretch justify-center gap-3 md:flex-row md:items-center">
          <div className="card flex-1 p-5 text-center">
            <div className="text-sm font-semibold text-white">{t("land.how.agent")}</div>
            <div className="muted mt-1 text-xs leading-snug">{t("land.how.agent.sub")}</div>
          </div>
          <FlowArrow />
          <div className="relative flex-1 rounded-2xl border border-brand/40 bg-brand/10 p-5 text-center shadow-glow">
            <div className="mx-auto mb-2 grid h-9 w-9 place-items-center rounded-xl bg-brand/20 text-brand-bright ring-1 ring-brand/40">
              <ShieldMark className="h-5 w-5" />
            </div>
            <div className="text-sm font-bold text-white">{t("land.how.guard")}</div>
            <div className="mt-1 text-xs font-medium text-brand-bright">{t("land.how.guard.sub")}</div>
          </div>
          <FlowArrow />
          <div className="card flex-1 p-5 text-center">
            <div className="text-sm font-semibold text-white">{t("land.how.tools")}</div>
            <div className="muted mt-1 text-xs leading-snug">{t("land.how.tools.sub")}</div>
          </div>
        </div>

        {/* 3 steps */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {STEPS.map(([title, body]) => (
            <div key={title} className="card p-5">
              <h3 className="font-semibold text-brand-bright">{t(title)}</h3>
              <p className="muted mt-1.5 text-sm leading-relaxed">{t(body)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="text-center">
          <span className="label text-brand-bright">{t("land.feat.kicker")}</span>
          <h2 className="mt-2 text-2xl font-bold sm:text-3xl">{t("land.feat.title")}</h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.t} className="card p-6">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand/15 text-brand-bright ring-1 ring-brand/30">
                <FeatureIcon d={ICONS[f.icon]} />
              </div>
              <h3 className="mt-4 font-semibold">{t(f.t)}</h3>
              <p className="muted mt-1.5 text-sm leading-relaxed">{t(f.b)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Compliance */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/15 to-transparent p-7 sm:p-10">
          <span className="label text-brand-bright">{t("land.comp.kicker")}</span>
          <h2 className="mt-2 max-w-2xl text-2xl font-bold sm:text-3xl">{t("land.comp.title")}</h2>
          <p className="muted mt-4 max-w-3xl text-base leading-relaxed">{t("land.comp.body")}</p>
        </div>
      </section>

      {/* Who it's for */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="text-center">
          <span className="label text-brand-bright">{t("land.who.kicker")}</span>
          <h2 className="mt-2 text-2xl font-bold sm:text-3xl">{t("land.who.title")}</h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {WHO.map(([title, body]) => (
            <div key={title} className="card p-6">
              <h3 className="font-semibold">{t(title)}</h3>
              <p className="muted mt-1.5 text-sm leading-relaxed">{t(body)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="card flex flex-col items-center gap-5 p-10 text-center">
          <h2 className="max-w-2xl text-2xl font-bold sm:text-3xl">{t("land.cta.title")}</h2>
          <p className="muted max-w-xl">{t("land.cta.body")}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/login" className="btn btn-primary">
              {t("land.hero.cta")}
            </Link>
            <a href={DEMO_MAILTO} className="btn btn-ghost">
              {t("land.nav.demo")}
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand/15 text-brand-bright ring-1 ring-brand/30">
              <ShieldMark className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold">
              xSOM <span className="font-medium text-white/50">AI Guard</span>
            </span>
          </div>
          <p className="muted text-xs">{t("land.footer.tech")}</p>
          <p className="muted text-xs">{t("land.footer.rights")}</p>
        </div>
      </footer>
    </main>
  );
}
