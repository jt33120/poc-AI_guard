import type { Config } from "tailwindcss";

// Les jetons vivent dans `app/globals.css`, portés depuis `xsom.fr`. Ce fichier ne
// fait que les référencer : une valeur écrite ici en dur serait une seconde source
// de vérité, et les deux divergeraient.
//
// `brand` reste le nom du jeton d'accent, mais il pointe désormais sur le cuivre.
// Repointer plutôt que renommer migre les dix-sept fichiers qui l'utilisent d'un
// seul changement, sans toucher un composant — et les couleurs restent au seul
// endroit qui les définit.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "var(--ink-900)",
          mid: "var(--ink-800)",
          light: "var(--ink-700)",
        },
        brand: {
          DEFAULT: "var(--copper)",
          bright: "var(--copper-sheen)",
          deep: "var(--copper-deep)",
          shade: "var(--copper-shade)",
        },
        ink: {
          950: "var(--ink-950)",
          900: "var(--ink-900)",
          800: "var(--ink-800)",
          700: "var(--ink-700)",
          600: "var(--ink-600)",
        },
        paper: {
          DEFAULT: "var(--paper)",
          warm: "var(--paper-warm)",
          dim: "var(--paper-dim)",
        },
        accent: "var(--text-low)",
      },
      fontFamily: {
        // Le corps. Inter, auto-hébergée.
        sans: ["var(--font-body)", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        // Les titres. Saira, descendue de la DIN.
        display: ["var(--font-display)", "Roboto Condensed", "Arial Narrow", "sans-serif"],
        // Toute étiquette, tout chiffre.
        mono: ["var(--font-mono)", "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      // Angles quasi droits, registre technique. L'échelle est redéfinie plutôt
      // qu'étendue : `rounded-xl` et `rounded-2xl` sont employés dans vingt et un
      // fichiers, et les laisser à 12 et 16 px aurait gardé l'arrondi SaaS partout
      // où le port ne passe pas.
      borderRadius: {
        none: "0",
        sm: "3px",
        DEFAULT: "4px",
        md: "4px",
        lg: "6px",
        xl: "6px",
        "2xl": "6px",
        "3xl": "6px",
        // Conservé pour ne casser aucun appel existant, mais ramené dans le
        // registre : le système refuse la pilule.
        pill: "6px",
        full: "9999px",
      },
      boxShadow: {
        relief: "var(--copper-relief)",
        glow: "0 6px 18px -10px var(--copper-glow)",
        card: "none",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: { "fade-up": "fadeUp 0.6s cubic-bezier(0.25,0.46,0.45,0.94) both" },
    },
  },
  plugins: [],
};

export default config;
