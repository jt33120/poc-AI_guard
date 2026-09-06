import type { Metadata } from "next";
import localFont from "next/font/local";

import { LanguageProvider } from "@/lib/i18n";
import "./globals.css";

// Les trois voix du système xSOM, reprises de `xsom.fr`. Elles ont des rôles
// distincts, et c'est le système à trois voix qui fait l'identité — pas une police
// de plus : Saira compose les titres, Inter le corps, JetBrains Mono **toute**
// étiquette et tout chiffre.
//
// Auto-hébergées, et c'est une décision de doctrine, pas une optimisation : aucune
// adresse IP de visiteur n'est transmise à un tiers, une requête externe de moins au
// chargement, et la cohérence avec ce que le cabinet défend en matière de
// souveraineté. Passer par `next/font/google` annulerait cela pour économiser trois
// fichiers de 103 Ko au total. Licence SIL OFL 1.1, redistribuables.

// Saira descend de la DIN : la lettre de la signalétique technique, des plans
// d'infrastructure et de l'étiquetage industriel. Fichier variable, 600 à 800.
const saira = localFont({
  src: "../public/fonts/saira-600-800.woff2",
  weight: "600 800",
  style: "normal",
  variable: "--font-display",
  display: "swap",
  fallback: ["Roboto Condensed", "Arial Narrow", "sans-serif"],
});

const inter = localFont({
  src: "../public/fonts/inter-400.woff2",
  weight: "400",
  style: "normal",
  variable: "--font-body",
  display: "swap",
  fallback: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
});

const mono = localFont({
  src: "../public/fonts/jetbrains-mono-500.woff2",
  weight: "500",
  style: "normal",
  variable: "--font-mono",
  display: "swap",
  fallback: ["ui-monospace", "SF Mono", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: "xSOM AI Guard",
  description:
    "Passerelle de contrôle des actions pour agents IA. Chaque appel d'outil reçoit un " +
    "verdict de politique, les actions irréversibles attendent un humain, et tout entre " +
    "dans un journal d'audit chaîné.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${saira.variable} ${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
