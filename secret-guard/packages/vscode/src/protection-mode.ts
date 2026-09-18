import type { ProtectionMode } from "@xsom/secret-guard-cli/hook";

export const PROTECTION_MODES: ReadonlyArray<{
  mode: ProtectionMode;
  label: string;
  description: string;
  detail: string;
}> = [
  {
    mode: "block",
    label: "🔒 Bloquer",
    description: "Arrêter les messages contenant un secret détecté.",
    detail:
      "Les détections ambiguës et les analyses incomplètes bloquent aussi l’envoi.",
  },
  {
    mode: "redact",
    label: "🧹 Expurger",
    description: "Masquer les secrets avant de partager.",
    detail:
      "Automatique dans @secretguard et dans les sessions Claude raccordées à xSOM. Ailleurs : envoi arrêté, puis un clic sur Secret Guard dans la barre d’état expurge le presse-papiers.",
  },
  {
    mode: "observe",
    label: "👁️ Avertir et laisser passer",
    description: "Transmettre le texte original, même avec des secrets.",
    detail:
      "Secret Guard signale les détections sans bloquer ni nettoyer le message.",
  },
];

export function isProtectionMode(value: unknown): value is ProtectionMode {
  return value === "block" || value === "redact" || value === "observe";
}

export function protectionMode(value: unknown): ProtectionMode {
  return isProtectionMode(value) ? value : "block";
}

const SHORT_LABELS: Record<ProtectionMode, string> = {
  observe: "Avertir",
  redact: "Expurger",
  block: "Bloquer",
};

export function modeShortLabel(mode: ProtectionMode): string {
  return SHORT_LABELS[mode];
}

export function modeLabel(mode: ProtectionMode): string {
  return (
    PROTECTION_MODES.find((entry) => entry.mode === mode)?.label ?? "🔒 Bloquer"
  );
}
