import type { Config } from "tailwindcss";

// Design tokens mirror the xSOM brand site (xsom.fr): dark navy canvas,
// blue accent, Plus Jakarta Sans, soft translucent surfaces.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#0a1628", mid: "#0f2038", light: "#162d4a" },
        brand: { DEFAULT: "#2563eb", bright: "#3b82f6" },
        accent: "#bfc5ce",
      },
      fontFamily: {
        sans: ["var(--font-jakarta)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: { pill: "999px" },
      boxShadow: {
        glow: "0 8px 30px -10px rgba(37,99,235,0.7)",
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 50px -30px rgba(0,0,0,0.8)",
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
