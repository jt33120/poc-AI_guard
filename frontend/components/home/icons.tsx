/**
 * Les pictogrammes des pages publiques, repris de Lucide (https://lucide.dev, licence
 * ISC) et tracés d'origine sur une grille de 24 : lecteur (play, pause, volume-2,
 * volume-x), chevrons, et les glyphes du schéma Secret Guard (code-xml, activity,
 * sliders-horizontal, shield-check, square-terminal, server, download). Le projet
 * n'embarque pas de bibliothèque d'icônes pour quelques glyphes.
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

export const CodeIcon = () => <Icon><path d="m18 16 4-4-4-4" /><path d="m6 8-4 4 4 4" /><path d="m14.5 4-5 16" /></Icon>;

export const ActivityIcon = () => <Icon><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" /></Icon>;

export const SlidersIcon = () => (
  <Icon>
    <line x1="21" x2="14" y1="4" y2="4" /><line x1="10" x2="3" y1="4" y2="4" />
    <line x1="21" x2="12" y1="12" y2="12" /><line x1="8" x2="3" y1="12" y2="12" />
    <line x1="21" x2="16" y1="20" y2="20" /><line x1="12" x2="3" y1="20" y2="20" />
    <line x1="14" x2="14" y1="2" y2="6" /><line x1="8" x2="8" y1="10" y2="14" /><line x1="16" x2="16" y1="18" y2="22" />
  </Icon>
);

export const ShieldCheckIcon = ({ size = 20 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const TerminalIcon = () => <Icon><path d="m7 11 2-2-2-2" /><path d="M11 13h4" /><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /></Icon>;

export const ServerIcon = () => (
  <Icon>
    <rect width="20" height="8" x="2" y="2" rx="2" ry="2" /><rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
    <line x1="6" x2="6.01" y1="6" y2="6" /><line x1="6" x2="6.01" y1="18" y2="18" />
  </Icon>
);

export const DownloadIcon = () => <Icon><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></Icon>;
