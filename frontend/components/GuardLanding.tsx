"use client";

import { useRef } from "react";
import { GuardFooter } from "@/components/GuardFooter";
import { HomeExposure } from "@/components/home/HomeExposure";
import { HomeFilm } from "@/components/home/HomeFilm";
import { HomeHeader } from "@/components/home/HomeHeader";
import { HomePaths } from "@/components/home/HomePaths";
import { HomeSecretGuard } from "@/components/home/HomeSecretGuard";
import { useHomeReveal } from "@/components/home/useHomeReveal";

/**
 * La page d'accueil. Tout son habillage vit sous `.xhome` (`app/home.css`) : les
 * autres pages publiques partagent l'en-tête, le pied de page et `guard-home.css`,
 * et aucune règle de l'accueil ne doit les atteindre.
 */
export function GuardLanding() {
  const root = useRef<HTMLDivElement>(null);
  useHomeReveal(root);
  return (
    <div ref={root} className="guard-landing xhome">
      <HomeHeader />
      <main>
        <HomeFilm />
        <HomeExposure />
        <HomePaths />
        <HomeSecretGuard />
      </main>
      <GuardFooter />
    </div>
  );
}
