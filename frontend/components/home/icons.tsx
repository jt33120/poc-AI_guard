/**
 * Les pictogrammes du lecteur et du carrousel, repris de Lucide (https://lucide.dev,
 * licence ISC) : play, pause, volume-2, volume-x et les chevrons gauche, droite et
 * bas, tracés d'origine sur une grille de 24. Le projet n'embarque pas de
 * bibliothèque d'icônes pour sept glyphes.
 */
import type { ReactNode } from "react";

function Icon({ children, size = 20, stroke = 2 }: { children: ReactNode; size?: number; stroke?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const SPEAKER = "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z";

export const PlayIcon = () => <Icon><polygon points="6 3 20 12 6 21 6 3" /></Icon>;

export const PauseIcon = () => <Icon><rect x="14" y="4" width="4" height="16" rx="1" /><rect x="6" y="4" width="4" height="16" rx="1" /></Icon>;

export const VolumeIcon = () => <Icon><path d={SPEAKER} /><path d="M16 9a5 5 0 0 1 0 6" /><path d="M19.364 18.364a9 9 0 0 0 0-12.728" /></Icon>;

export const MutedIcon = () => <Icon><path d={SPEAKER} /><line x1="22" x2="16" y1="9" y2="15" /><line x1="16" x2="22" y1="9" y2="15" /></Icon>;

export const ChevronLeftIcon = () => <Icon><path d="m15 18-6-6 6-6" /></Icon>;

export const ChevronRightIcon = () => <Icon><path d="m9 18 6-6-6-6" /></Icon>;

/** Le chevron du film, large et fin : il invite à faire défiler sans peser sur l'image. */
export const ChevronDownIcon = () => <Icon size={44} stroke={1.25}><path d="m4 9 8 7 8-7" /></Icon>;
