"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Wordmark, XsomMark } from "@/components/brand";
import { GuardNav } from "@/components/GuardNav";
import { SignalPreferences } from "@/design-system/react";
import { useT } from "@/lib/i18n";
import { DEVELOPER_COPY } from "./developer-copy";

export function DeveloperPublicShell({
  current,
  children,
}: {
  current: "overview" | "security" | "pricing" | "trust";
  children: ReactNode;
}) {
  const { lang } = useT();
  const copy = DEVELOPER_COPY[lang];
  const links = [
    ["overview", "/developpeurs", copy.nav.overview],
    ["security", "/developpeurs/securite", copy.nav.security],
    ["pricing", "/developpeurs/tarifs", copy.nav.pricing],
    ["trust", "/developpeurs/confiance", lang === "fr" ? "Engagement xSOM" : "xSOM commitment"],
  ] as const;

  return (
    <div className="guard-landing developer-site">
      <header className="guard-header">
        <div className="guard-wrap guard-header__inner">
          <Link href="/" className="brand" aria-label="xSOM AI Guard">
            <XsomMark />
            <Wordmark />
          </Link>
          <GuardNav />
        </div>
        <nav className="developer-subnav guard-wrap" aria-label={copy.shellLabel}>
          <strong>{copy.shellLabel}</strong>
          <div>
            {links.map(([id, href, label]) => (
              <Link key={id} href={href} aria-current={current === id ? "page" : undefined}>
                {label}
              </Link>
            ))}
          </div>
        </nav>
      </header>
      {children}
      <footer className="guard-footer">
        <div className="guard-wrap">
          <Link href="/" className="brand" aria-label="xSOM AI Guard">
            <XsomMark />
            <Wordmark />
          </Link>
          <p>{copy.footer}</p>
          <Link href="/menaces">{lang === "fr" ? "Menaces & couverture" : "Threats & coverage"}</Link>
          <Link href="/developpeurs/confiance">{lang === "fr" ? "Engagement xSOM" : "xSOM commitment"}</Link>
          <details>
            <summary>{copy.display}</summary>
            <SignalPreferences lang={lang} />
          </details>
        </div>
      </footer>
    </div>
  );
}
