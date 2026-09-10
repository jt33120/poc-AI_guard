"use client";

/**
 * Les deux mouvements de la charte `xsom.fr`, portés tels quels : la révélation au
 * défilement (`assets/js/motion.js`) et le balayage de titre qui suit le pointeur
 * (`assets/js/ui.js`).
 *
 * Le composant ne rend rien, et ne décide pas non plus si le mouvement a lieu :
 * cette décision est prise avant peinture par le script d'amorce de
 * `app/layout.tsx`, qui pose `data-motion` sur `<html>`. Ici on ne fait que lire ce
 * marqueur, une seule condition, écrite à un seul endroit.
 */

import { useEffect } from "react";

/** Le balayage déborde de 30 % de part et d'autre : la lumière entre dans le titre
 *  et en sort, au lieu de rester collée à ses bords. */
const SHEEN_OVERSHOOT = 30;
const SHEEN_TRAVEL = 160;

function watchReveal(): () => void {
  const targets = document.querySelectorAll<HTMLElement>(".reveal");
  if (targets.length === 0) return () => {};

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    // Seuil à 0, là où le site utilise 0.2. Sur `xsom.fr`, `.reveal` n'habille que
    // des cartes ; ici il habille aussi des sections entières, et une section plus
    // haute que la fenêtre n'atteint jamais 20 % de visibilité : elle resterait
    // masquée définitivement. La marge basse négative redonne le même déclenchement
    // à l'œil, sans le point mort.
    { threshold: 0, rootMargin: "0px 0px -12% 0px" },
  );

  targets.forEach((target) => observer.observe(target));
  return () => observer.disconnect();
}

function watchTitleSheen(): () => void {
  const titles = Array.from(
    document.querySelectorAll<HTMLElement>("[data-sheen]"),
  );
  if (titles.length === 0) return () => {};

  let pointerX = 0;
  let pending = false;

  const paint = (): void => {
    pending = false;
    const viewport = window.innerHeight;
    for (const title of titles) {
      const box = title.getBoundingClientRect();
      // Hors écran : inutile de repeindre, et la valeur serait aberrante.
      if (box.width === 0 || box.bottom < 0 || box.top > viewport) continue;
      const ratio = (pointerX - box.left) / box.width;
      const clamped = Math.min(1.6, Math.max(-0.6, ratio));
      const position = -SHEEN_OVERSHOOT + clamped * SHEEN_TRAVEL;
      // Une seule custom property réécrite : le navigateur ne recalcule aucune mise
      // en page, il repeint.
      title.style.setProperty("--title-sheen-pos", `${position.toFixed(1)}%`);
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    pointerX = event.clientX;
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(paint);
  };

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  return () => window.removeEventListener("pointermove", onPointerMove);
}

export function Motion(): null {
  useEffect(() => {
    // Posé par le script d'amorce, et seulement hors `prefers-reduced-motion`.
    if (document.documentElement.dataset.motion !== "on") return;
    if (document.querySelector(".console-shell")) return;

    const stopReveal = watchReveal();
    // Un survol n'a pas de sens au doigt : sans pointeur fin la variable garde ses
    // 50 %, et la lumière reste au centre du titre.
    const stopSheen = window.matchMedia("(pointer: fine)").matches
      ? watchTitleSheen()
      : () => {};

    return () => {
      stopReveal();
      stopSheen();
    };
  }, []);

  return null;
}
