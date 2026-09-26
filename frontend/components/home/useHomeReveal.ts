"use client";

import { useEffect, type RefObject } from "react";

/**
 * Marque `data-shown` sur chaque `[data-reveal]` de la page d'accueil quand il entre
 * dans la fenêtre.
 *
 * L'observation tourne toujours ; c'est la feuille de style qui ne masque qu'avec
 * `data-motion="on"` sur `<html>`. Activer le mouvement en cours de lecture ne peut
 * donc pas laisser un bloc déjà passé à l'état caché.
 */
export function useHomeReveal(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const scope = root.current;
    if (!scope) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-shown", "");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    scope.querySelectorAll("[data-reveal]:not([data-shown])").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [root]);
}
