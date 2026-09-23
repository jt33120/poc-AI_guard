"use client";

/**
 * Le menu, écrit une seule fois.
 *
 * Le menu porte les trois portes publiques demandées par le site : les produits, les
 * besoins cyber et le cabinet qui accompagne les déploiements. La quatrième action
 * ouvre la découverte des solutions xSOM, sans confondre cette porte avec l'accès à
 * une console.
 *
 * Une seule définition, partagée par tous les en-têtes publics. Chaque page portait sa
 * copie du menu, avec des entrées différentes : elles divergeaient déjà, et rien ne
 * l'aurait signalé.
 *
 * La classe `guard-nav__link` permet à la feuille de style de garder les liens
 * éditoriaux distincts de l'action principale sur les petits écrans.
 */

import Link from "next/link";

import { GUARD_HOME_COPY } from "@/components/guard-home-copy";
import { LanguageToggle, useT } from "@/lib/i18n";

export function GuardNav() {
  const { lang } = useT();
  const home = GUARD_HOME_COPY[lang];
  return (
    <nav
      aria-label={lang === "fr" ? "Navigation principale" : "Main navigation"}
    >
      <Link className="guard-nav__link" href="/produits">
        {home.navProducts}
      </Link>
      <Link className="guard-nav__link" href="/developpeurs">
        {home.navDevelopers}
      </Link>
      <Link className="guard-nav__link" href="/menaces">
        {home.navGlossary}
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
      <Link className="guard-nav__link" href="/developpeurs/tarifs">{lang === "fr" ? "Tarifs" : "Pricing"}</Link>
      <LanguageToggle />
      <Link href="/extension" className="guard-button guard-button--small">
        {lang === "fr" ? "Commencer gratuitement" : "Start for free"}
        <span aria-hidden="true">↗</span>
      </Link>
    </nav>
  );
}
