import type { Metadata } from "next";
import localFont from "next/font/local";

import { Motion } from "@/components/Motion";
import { LanguageProvider } from "@/lib/i18n";
import { getLang, translate } from "@/lib/lang";
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

// Résolue par requête, depuis la langue du visiteur. Une `metadata` statique aurait
// annoncé un titre anglais à un lecteur français, et l'inverse, ce qui est exactement
// ce qu'un moteur de recherche indexe.
//
// Pas d'`alternates.languages` : la langue tient à un cookie, les deux versions
// partagent donc la même URL. Déclarer un `hreflang` `en` pointant sur `/` serait
// faux, et un robot, qui n'a pas de cookie, verrait de toute façon le français aux
// deux adresses. Conséquence assumée et notée : **seul le français est indexable**.
// Rendre l'anglais indexable demande des routes de langue, pas une balise de plus.
export function generateMetadata(): Metadata {
  const lang = getLang();
  const titre = `xSOM AI Guard · ${translate(lang, "meta.tagline")}`;
  const description = translate(lang, "meta.description");
  return {
    title: { default: titre, template: "%s · xSOM AI Guard" },
    description,
    openGraph: {
      title: titre,
      description,
      locale: lang === "fr" ? "fr_FR" : "en_US",
      type: "website",
      siteName: "xSOM AI Guard",
    },
  };
}

// Décide, AVANT peinture, si le mouvement a lieu. Un `useEffect` s'exécute après le
// premier rendu : on verrait les blocs apparaître, disparaître, puis se révéler.
// C'est le SEUL endroit où la condition est écrite, `Motion.tsx` ne fait que lire le
// marqueur. Littéral constant, aucune interpolation.
const MOTION_BOOTSTRAP =
  "if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&'IntersectionObserver' in window)" +
  "document.documentElement.setAttribute('data-motion','on')";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // `<html lang>` était écrit en dur à `fr` pendant que la page rendait l'anglais par
  // défaut : l'attribut contredisait le texte qu'il qualifiait. Un lecteur d'écran
  // lisait donc de l'anglais avec une voix française. Résolu, il ne peut plus mentir
  // ni dans un sens ni dans l'autre.
  const lang = getLang();
  return (
    <html
      lang={lang}
      className={`${saira.variable} ${inter.variable} ${mono.variable}`}
      // `data-motion` est posé sur `<html>` par le script ci-dessous, avant
      // hydratation : React lit alors un attribut qu'il n'a pas rendu et avertit.
      // L'attribut ne fait pas partie de l'arbre React, il ne sera jamais réconcilié,
      // seul l'avertissement est à taire. Un marqueur en CLASSE aurait été détruit,
      // lui, car `className` de `<html>` est rendu ici et donc géré par React.
      suppressHydrationWarning
    >
      <body className="min-h-screen font-sans antialiased">
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOTSTRAP }} />
        <Motion />
        <LanguageProvider initial={lang}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
