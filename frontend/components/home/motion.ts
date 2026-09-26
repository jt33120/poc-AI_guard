import type { MouseEvent } from "react";

/** Préférence système, ou réglage « Réduire les animations » du site. */
export function motionReduced(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.reducedMotion === "true";
}

/**
 * Un lien d'ancre qui glisse jusqu'à sa cible au lieu d'y sauter, sauf quand le
 * mouvement est réduit. L'adresse garde l'ancre, comme un lien ordinaire.
 */
export function glideTo(event: MouseEvent<HTMLAnchorElement>) {
  const target = event.currentTarget.hash ? document.getElementById(event.currentTarget.hash.slice(1)) : null;
  if (!target || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: motionReduced() ? "auto" : "smooth", block: "start" });
  history.pushState(null, "", event.currentTarget.hash);
}
