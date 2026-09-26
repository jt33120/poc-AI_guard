"use client";

import Link from "next/link";
import { useRef } from "react";
import { GUARD_HOME_COPY } from "@/components/guard-home-copy";
import { GuardOffers } from "@/components/GuardOffers";
import { GuardFooter } from "@/components/GuardFooter";
import { HomeFilm } from "@/components/home/HomeFilm";
import { HomeHeader } from "@/components/home/HomeHeader";
import { useHomeReveal } from "@/components/home/useHomeReveal";
import { ProductsCarousel } from "@/components/products/ProductsCarousel";
import { PRODUCTS_HERO_MEDIA } from "@/components/products/products-copy";
import { useT } from "@/lib/i18n";

/**
 * La page des produits : le film de la gamme sous l'en-tête de l'accueil, les deux
 * produits en carrousel, puis les éditions de Secret Guard et leurs tarifs.
 */
export function ProductsOffer() {
  const { lang } = useT();
  const home = GUARD_HOME_COPY[lang];
  const root = useRef<HTMLDivElement>(null);
  useHomeReveal(root);
  return (
    <div ref={root} className="guard-landing xhome xproducts">
      <HomeHeader />
      <main>
        <HomeFilm media={PRODUCTS_HERO_MEDIA} next="#gamme" />
        <ProductsCarousel />
        <GuardOffers />
        <aside className="guard-glossary-link guard-wrap reveal"><span className="guard-glossary-link__icon" aria-hidden="true">Aa</span><div><h3>{home.glossaryTitle}</h3><p>{home.glossaryBody}</p></div><Link href="/menaces">{home.glossaryAction} ↗</Link></aside>
      </main>
      <GuardFooter />
    </div>
  );
}
