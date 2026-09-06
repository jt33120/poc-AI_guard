import Link from "next/link";

import { ShieldMark } from "@/components/brand";
import { ExecutiveSummary } from "@/components/ExecutiveSummary";
import { JournalDemo } from "@/components/JournalDemo";
import { INSTANTANE, seaux } from "@/lib/demo";
import { LanguageToggle } from "@/lib/i18n";
import { pageMetadata, serverT } from "@/lib/lang";

export function generateMetadata() {
  return pageMetadata("exec.title", { descriptionKey: "exec.subtitle" });
}

const DEMO_MAILTO = "mailto:julian.talou@xsom.fr?subject=xSOM%20AI%20Guard%20%3A%20demo";

// Les chiffres viennent de l'instantané **relu** du tenant de démonstration, pas
// d'un échantillon. Ils étaient écrits à la main jusqu'à `L8` — `governed: 8`,
// `allow: 124` — là où le tenant réel en compte 5 et 93. Un chiffre inventé flatte,
// toujours, sans qu'on l'ait décidé : c'est ce qui le rend dangereux sur une page
// publique, pas son inexactitude.

// Composant serveur : la page ne fait qu'afficher. `<ExecutiveSummary />` reste un
// îlot client, parce que la console l'emploie aussi et l'y veut interactif.
export default function ExecutivePreviewPage() {
  const { t } = serverT();
  return (
    <main className="relative">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-navy/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/15 text-brand-bright ring-1 ring-brand/30">
              <ShieldMark className="h-5 w-5" />
            </span>
            <span className="text-[15px] font-bold tracking-tight">
              xSOM <span className="font-medium text-white/50">AI Guard</span>
            </span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageToggle />
            <Link href="/login" className="btn btn-ghost hidden px-4 py-1.5 sm:inline-flex">
              {t("land.nav.signin")}
            </Link>
            <a href={DEMO_MAILTO} className="btn btn-primary px-4 py-1.5">
              {t("land.nav.demo")}
            </a>
          </div>
        </div>
      </header>

      <section className="mx-auto flex max-w-6xl animate-fade-up flex-col gap-8 px-4 py-10 sm:px-6">
        <header>
          <h1 className="text-2xl font-bold sm:text-3xl">{t("exec.title")}</h1>
          <p className="muted mt-1.5 max-w-2xl">{t("exec.subtitle")}</p>
          <p className="mt-3 inline-flex rounded-pill border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-300">
            {t("exec.preview.note")}
          </p>
          {/* Le bandeau de provenance : ce que la page est, daté et signé par un
              commit. Sans lui, un lecteur ne peut pas distinguer une lecture d'une
              maquette — et c'est précisément la distinction que ce produit vend. */}
          <p className="muted mt-3 max-w-3xl font-mono text-[11px] leading-relaxed">
            {t("demo.bandeau", { date: INSTANTANE.genere_le, commit: INSTANTANE.commit })}
            {INSTANTANE.chainee && ` ✓ ${t("demo.bandeau.chaine")}`}
          </p>
          <p className="muted mt-3 max-w-2xl text-sm leading-relaxed">{t("demo.lede")}</p>
        </header>

        <ExecutiveSummary
          governed={INSTANTANE.outils}
          counts={seaux(INSTANTANE.decisions)}
          entrees={INSTANTANE.entrees}
        />

        <JournalDemo />

        <div className="card flex flex-col items-center gap-4 p-8 text-center">
          <p className="muted max-w-xl">{t("land.cta.body")}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/login" className="btn btn-primary">
              {t("land.hero.cta")}
            </Link>
            <a href={DEMO_MAILTO} className="btn btn-ghost">
              {t("land.nav.demo")}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
