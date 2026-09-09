import Link from "next/link";

import { ShieldMark, Wordmark, XsomMark } from "@/components/brand";
import { Audience } from "@/components/Audience";
import { Fonctionnement } from "@/components/Fonctionnement";
import { ProfilProvider } from "@/components/ProfilContext";
import { ThreatLedger } from "@/components/ThreatLedger";
import { LanguageToggle } from "@/lib/i18n";
import { serverT } from "@/lib/lang";
import type { StrKey } from "@/lib/strings";

const DEMO_MAILTO = "mailto:julian.talou@xsom.fr?subject=xSOM%20AI%20Guard%20%3A%20demo";

const WHO: [StrKey, StrKey][] = [
  ["land.who.1.t", "land.who.1.b"],
  ["land.who.2.t", "land.who.2.b"],
  ["land.who.3.t", "land.who.3.b"],
];

// Composant **serveur**. La page n'avait aucune interactivité en propre : elle
// portait `"use client"` uniquement parce que `useT` était un hook. La traduction
// venant désormais du serveur, la page peut redevenir ce qu'elle est, et le layout
// racine peut enfin exporter `metadata` et l'Open Graph. Le seul îlot client qui
// reste est `<LanguageToggle />`, qui écoute un clic.
export default function LandingPage() {
  const { t } = serverT();
  return (
    <main className="relative">
      {/* Top bar */}
      {/* Le voile est porté par `.site-header` et non par un `bg-navy/xx` : Tailwind
          n'émet aucune règle quand on demande une opacité sur une couleur qui vaut
          `var(--ink-900)`, si bien que la barre était en réalité transparente. Le
          défaut ne se voyait pas sur une page uniformément sombre ; deux sections
          passent maintenant en bande claire, et le papier remontait au travers. */}
      <header className="site-header sticky top-0 z-30 border-b border-white/10 backdrop-blur-xl">
        <div className="wrap flex h-16 items-center justify-between">
          <div className="brand">
            <XsomMark />
            <span>
              {/* Le nom accessible reste « xSOM AI Guard » : la baseline est hors du
                  h1, sinon elle entrerait dans le nom que `e2e/smoke.spec.ts`
                  cherche. */}
              <h1 className="brand__name">
                xSOM <span className="brand__product">AI Guard</span>
              </h1>
              <span className="brand__tag">{t("brand.tagline")}</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
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

      {/* Hero */}
      <section className="page-head page-head--visual">
        <div className="wrap page-head__inner">
          <div className="animate-fade-up">
            <p className="eyebrow" data-num="—">
              {t("land.hero.badge")}
            </p>
            {/* Reste un `<p>` : le `<h1>` de la page est le mot-marque de l'en-tête,
                et le promouvoir ici ajouterait un second titre de rang 1. */}
            <p className="t-h1 mt-6 max-w-4xl" data-sheen>
              {t("land.hero.title")}
            </p>
            <p className="lead mt-6">{t("land.hero.sub")}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/signup" className="btn btn-primary">
                {t("land.hero.cta")}
              </Link>
              <Link href="/login" className="btn btn-ghost">
                {t("land.hero.cta2")}
              </Link>
              <Link href="/executive-preview" className="btn btn-ghost">
                {t("land.exec.link")}
              </Link>
              <span className="muted ml-1 inline-flex items-center gap-1.5 text-sm">
                <ShieldMark className="h-4 w-4 text-brand-bright" />
                {t("land.hero.trust")}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Le relevé (L5) et « Pour qui » (L7) répondent à deux questions à partir du
          **même** choix de profils : ce qui vous concerne, et ce qui le deviendrait.
          Un seul sélecteur, donc un seul état, et un seul appel au moteur — deux
          sélecteurs poseraient au visiteur une question à laquelle il a répondu.
          Les seize lignes restent rendues côté serveur : un robot les voit sans
          exécuter de JavaScript. Ils portent les numéros 01 et 02 de la page. */}
      <ProfilProvider>
        <ThreatLedger />
        <Audience />
      </ProfilProvider>

      {/* Problem */}
      {/* Deux colonnes éditoriales, et plus de carte : une carte autour d'une section
          entière est précisément la forme que le site refuse. */}
      <section className="section">
        <div className="wrap split">
          <div>
            <p className="eyebrow" data-num="03">
              {t("land.problem.kicker")}
            </p>
            <h2 className="t-h2 mt-4" data-sheen>
              {t("land.problem.title")}
            </h2>
          </div>
          <div>
            <p className="lead">{t("land.problem.body")}</p>
          </div>
        </div>
      </section>

      {/* Comment ça marche — première bande claire. Le principe, la preuve et
          le branchement en une seule section : voir `components/Fonctionnement.tsx`
          pour pourquoi les trois ne font plus qu'un. */}
      <Fonctionnement />

      {/* Compliance — l'aparté, en bande resserrée. Le panneau en dégradé cuivre
          disparaît : sur le site, le cuivre se concentre dans le seul bandeau final
          plutôt que de se disperser en fonds de section. */}
      <section className="section section--tight">
        <div className="wrap split">
          <div>
            <p className="eyebrow" data-num="05">
              {t("land.comp.kicker")}
            </p>
            <h2 className="t-h2 mt-4" data-sheen>
              {t("land.comp.title")}
            </h2>
          </div>
          <div>
            <p className="lead">{t("land.comp.body")}</p>
          </div>
        </div>
      </section>

      {/* Who it's for — seconde bande claire. Section entièrement tokenisée
          (`.card`, `h3`, `.muted`) : elle bascule sans une seule substitution. */}
      <section className="section section--light">
        <div className="wrap">
          <div className="text-center">
            <p className="eyebrow" data-num="06">
              {t("land.who.kicker")}
            </p>
            <h2 className="t-h2 mt-2" data-sheen>
              {t("land.who.title")}
            </h2>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {WHO.map(([title, body], i) => (
              <div key={title} className="card reveal p-6" data-delay={String(i + 1)}>
                {/* Ces trois cartes sont les seules sans pastille d'icône : le numéro
                    y tient le rôle de marqueur d'entrée. Un chiffre nu est invariant
                    par langue, comme les `data-num` des chapeaux — il ne passe donc
                    pas par le dictionnaire. */}
                <span className="card__num">{`0${i + 1}`}</span>
                <h3 className="t-h3">{t(title)}</h3>
                <p className="muted mt-1.5 text-sm leading-relaxed">{t(body)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="section cta-band">
        <div className="wrap wrap--narrow cta-band__inner reveal">
          <p className="eyebrow" data-num="→">
            {t("land.cta.kicker")}
          </p>
          <h2 className="t-h2 mt-6" data-sheen>
            {t("land.cta.title")}
          </h2>
          <p className="lead mx-auto mt-4">{t("land.cta.body")}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="btn btn-primary">
              {t("land.hero.cta")}
            </Link>
            <a href={DEMO_MAILTO} className="btn btn-ghost">
              {t("land.nav.demo")}
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10">
        <div className="wrap flex flex-col gap-3 py-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="brand">
            <XsomMark className="h-8 w-8" />
            <Wordmark className="text-sm" />
          </div>
          <p className="muted text-xs">{t("land.footer.tech")}</p>
          <p className="muted text-xs">{t("land.footer.rights")}</p>
        </div>
      </footer>
    </main>
  );
}
