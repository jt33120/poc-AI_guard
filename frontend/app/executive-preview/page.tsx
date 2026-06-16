"use client";

import Link from "next/link";

import { ShieldMark } from "@/components/brand";
import { ExecutiveSummary } from "@/components/ExecutiveSummary";
import { LanguageToggle, useT } from "@/lib/i18n";

const DEMO_MAILTO = "mailto:julian.talou@xsom.fr?subject=xSOM%20AI%20Guard%20—%20demo";

// Public, prospect-facing preview of the executive summary — representative
// sample figures, no auth and no live data.
const SAMPLE = { governed: 8, counts: { allow: 124, review: 37, block: 9 } };

export default function ExecutivePreviewPage() {
  const { t } = useT();
  return (
    <main className="relative">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-navy/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/15 text-brand-bright ring-1 ring-brand/30">
              <ShieldMark className="h-5 w-5" />
            </span>
            <span className="text-[15px] font-bold tracking-tight">
              xSOM <span className="font-medium text-white/50">AI Guard</span>
            </span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
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

      <section className="mx-auto flex max-w-6xl animate-fade-up flex-col gap-8 px-4 py-10 sm:px-6">
        <header>
          <h1 className="text-2xl font-bold sm:text-3xl">{t("exec.title")}</h1>
          <p className="muted mt-1.5 max-w-2xl">{t("exec.subtitle")}</p>
          <p className="mt-3 inline-flex rounded-pill border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-300">
            {t("exec.preview.note")}
          </p>
        </header>

        <ExecutiveSummary governed={SAMPLE.governed} counts={SAMPLE.counts} />

        <div className="card flex flex-col items-center gap-4 p-8 text-center">
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
    </main>
  );
}
