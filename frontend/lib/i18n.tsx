"use client";

/**
 * La moitié cliente de la traduction : le contexte, le hook, et le sélecteur.
 *
 * Le dictionnaire lui-même vit dans `lib/strings.ts`, sans React, pour que le serveur
 * puisse le lire (voir `lib/lang.ts`). Tant qu'il vivait ici, toute page affichant un
 * mot devenait un composant client, et une page client ne peut pas exporter
 * `metadata` : le site n'avait donc ni titre par page, ni Open Graph, ni description.
 *
 * La langue **arrive du serveur** par `initial`, résolue depuis le cookie avant le
 * rendu. Il n'y a donc plus de bascule après hydratation : ce que le serveur a rendu
 * est déjà dans la bonne langue.
 */

import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";

import { STR, type Lang, type StrKey } from "@/lib/strings";

export { STR };
export type { Lang, StrKey };

const LANG_COOKIE = "xsom_lang";

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "fr",
  setLang: () => {},
});

export function LanguageProvider({
  children,
  initial = "fr",
}: {
  children: React.ReactNode;
  initial?: Lang;
}) {
  const [lang, setLang] = useState<Lang>(initial);
  const router = useRouter();

  const set = (l: Lang) => {
    setLang(l);
    if (typeof document !== "undefined") {
      // `SameSite=Lax` et pas de `httpOnly` : ce cookie ne porte aucune autorité, il
      // dit une préférence d'affichage. Un an, parce qu'un visiteur qui revient veut
      // la même langue qu'à sa visite précédente.
      document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    }
    // Les composants serveur ont rendu dans l'autre langue : il faut les redemander.
    router.refresh();
  };

  return <LangContext.Provider value={{ lang, setLang: set }}>{children}</LangContext.Provider>;
}

export function useT() {
  const { lang, setLang } = useContext(LangContext);
  const t = (key: StrKey, vars?: Record<string, string | number>) => {
    let s: string = STR[key]?.[lang] ?? STR[key]?.en ?? String(key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
  return { t, lang, setLang };
}

export function LanguageToggle() {
  const { lang, setLang } = useT();
  return (
    <div className="flex items-center rounded-sm border border-white/15 bg-white/[0.04] p-0.5 font-mono text-xs">
      {(["fr", "en"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={`rounded-sm px-2.5 py-1 transition ${
            lang === l ? "bg-brand text-white" : "text-white/55 hover:text-white"
          }`}
          aria-pressed={lang === l}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
