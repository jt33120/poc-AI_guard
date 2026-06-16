"use client";

import Link from "next/link";

import { Logo } from "@/components/brand";
import { LanguageToggle, type StrKey, useT } from "@/lib/i18n";

const PILLARS: [StrKey, StrKey][] = [
  ["welcome.p1.title", "welcome.p1.body"],
  ["welcome.p2.title", "welcome.p2.body"],
  ["welcome.p3.title", "welcome.p3.body"],
];

export default function HomePage() {
  const { t } = useT();
  return (
    <main className="relative min-h-screen">
      <div className="absolute right-6 top-6 z-10">
        <LanguageToggle />
      </div>
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
        <div className="animate-fade-up">
          <div className="mb-6 flex items-center gap-2.5">
            <Logo size="h-11 w-11" />
            {/* Heading text stays "xSOM AI Guard" for its accessible name. */}
            <h1 className="text-lg font-bold tracking-tight">
              xSOM <span className="font-medium text-white/50">AI Guard</span>
            </h1>
          </div>
          <span className="badge badge-blue">{t("welcome.badge")}</span>
          <p className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.06] tracking-tight text-white sm:text-5xl">
            {t("welcome.tagline")}
          </p>
          <p className="muted mt-5 max-w-2xl text-base leading-relaxed">{t("welcome.subtitle")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className="btn btn-primary">
              {t("welcome.cta.signin")}
            </Link>
            <Link href="/inspector" className="btn btn-ghost">
              {t("welcome.cta.open")}
            </Link>
          </div>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-3">
          {PILLARS.map(([title, body], i) => (
            <div key={title} className="card p-5">
              <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-brand/15 text-sm font-bold text-brand-bright ring-1 ring-brand/30">
                {i + 1}
              </div>
              <h2 className="font-semibold">{t(title)}</h2>
              <p className="muted mt-1.5 text-sm leading-relaxed">{t(body)}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="font-semibold">{t("welcome.monitors.title")}</h2>
          <p className="muted mt-1.5 max-w-3xl text-sm leading-relaxed">{t("welcome.monitors.body")}</p>
        </div>
      </div>
    </main>
  );
}
