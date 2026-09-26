"use client";

import Link from "next/link";

import { GUARD_HOME_COPY } from "@/components/guard-home-copy";
import { LanguageToggle, useT } from "@/lib/i18n";

export function GuardNav() {
  const { lang } = useT();
  const home = GUARD_HOME_COPY[lang];
  return (
    <div className="guard-nav-shell">
      <nav
        aria-label={lang === "fr" ? "Navigation principale" : "Main navigation"}
      >
        <Link className="guard-nav__link" href="/produits">
          {home.navProducts}
        </Link>
        <a
          className="guard-nav__link"
          href="https://www.xsom.fr"
          target="_blank"
          rel="noreferrer"
        >
          {home.navCabinet}
          <span aria-hidden="true">↗</span>
        </a>
        <Link className="guard-nav__link" href="/menaces">{home.navGlossary}</Link>
      </nav>
      <LanguageToggle />
    </div>
  );
}
