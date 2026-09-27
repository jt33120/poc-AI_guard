"use client";

import { useRef } from "react";
import { GuardFooter } from "@/components/GuardFooter";
import { HomeHeader } from "@/components/home/HomeHeader";
import { useHomeReveal } from "@/components/home/useHomeReveal";
import type { SecretGuardRelease } from "@/lib/secret-guard-release";
import { SgDownload } from "./SgDownload";
import { SgFlow } from "./SgFlow";
import { SgHero } from "./SgHero";
import { SgTour } from "./SgTour";

/**
 * La page Secret Guard, droit au but : ce qu'on résout, comment, le panneau bouton
 * par bouton, puis le téléchargement. Elle reprend l'en-tête et le style de l'accueil
 * (`.xhome`) ; ce qui lui est propre vit sous `.xsg` (`secret-guard.css`).
 */
export function SecretGuardPage({ release }: { release: SecretGuardRelease }) {
  const root = useRef<HTMLDivElement>(null);
  useHomeReveal(root);
  return (
    <div ref={root} className="guard-landing xhome xsg">
      <HomeHeader />
      <main>
        <SgHero version={release.version} />
        <SgFlow />
        <SgTour />
        <SgDownload release={release} />
      </main>
      <GuardFooter />
    </div>
  );
}
