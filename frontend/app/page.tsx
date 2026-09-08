import Link from "next/link";

import { ShieldMark, Wordmark, XsomMark } from "@/components/brand";
import { Audience } from "@/components/Audience";
import { ProfilProvider } from "@/components/ProfilContext";
import { ThreatLedger } from "@/components/ThreatLedger";
import { LanguageToggle } from "@/lib/i18n";
import { cleClair, cleEtape, cleTitre, ETAPES, MENACES } from "@/lib/menaces";
import { serverT } from "@/lib/lang";
import type { StrKey } from "@/lib/strings";

const DEMO_MAILTO = "mailto:julian.talou@xsom.fr?subject=xSOM%20AI%20Guard%20%3A%20demo";

const STEPS: [StrKey, StrKey][] = [
  ["land.how.s1.t", "land.how.s1.b"],
  ["land.how.s2.t", "land.how.s2.b"],
  ["land.how.s3.t", "land.how.s3.b"],
];

const WHO: [StrKey, StrKey][] = [
  ["land.who.1.t", "land.who.1.b"],
  ["land.who.2.t", "land.who.2.b"],
  ["land.who.3.t", "land.who.3.b"],
];

/**
 * Les cinq points de la chaîne, celui de l'étape allumé.
 *
 * `aria-hidden` parce que le nom de l'étape est écrit en toutes lettres juste à
 * côté : le glyphe répète, il n'informe pas. Un lecteur d'écran qui l'annoncerait
 * ferait entendre deux fois la même chose.
 */
function Points({ actif }: { actif: number }) {
  return (
    <svg viewBox="0 0 44 8" className="points" aria-hidden="true">
      <line className="points__voie" x1="4" y1="4" x2="40" y2="4" strokeWidth="1" />
      {ETAPES.map((etape, i) => (
        <circle
          key={etape}
          className={i === actif ? "points__point points__point--on" : "points__point"}
          cx={4 + i * 9}
          cy="4"
          r={i === actif ? 3 : 1.8}
        />
      ))}
    </svg>
  );
}

function FlowArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6 rotate-90 text-[color:var(--copper-text)] md:rotate-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

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
              <Link href="/login" className="btn btn-primary">
                {t("land.hero.cta")}
              </Link>
              <a href="#how" className="btn btn-ghost">
                {t("land.hero.cta2")}
              </a>
              <Link href="/executive-preview" className="btn btn-ghost">
                {t("land.exec.link")}
              </Link>
              <Link href="/mise-en-oeuvre" className="btn btn-ghost">
                {t("mise.kicker")}
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

      {/* How it works — première bande claire. Calque de la section « Trois garanties,
          dans cet ordre » d'`ai-guard.html` : même rôle (le mécanisme), même forme
          (chapeau, titre, trois cartes). Toutes les teintes écrites en dur à
          l'intérieur passent par les jetons contextuels, sinon le texte disparaîtrait
          sur le papier. */}
      <section id="how" className="section section--light scroll-mt-20">
        <div className="wrap">
          <div className="text-center">
            <p className="eyebrow" data-num="04">
              {t("land.how.kicker")}
            </p>
            <h2 className="t-h2 mt-2" data-sheen>
              {t("land.how.title")}
            </h2>
          </div>

          {/* Diagram: agent → guard → tools */}
          <div className="mt-12 flex flex-col items-stretch justify-center gap-3 md:flex-row md:items-center">
            <div className="card flex-1 p-6 text-center">
              <div className="text-sm font-semibold text-[color:var(--text-hi)]">
                {t("land.how.agent")}
              </div>
              <div className="muted mt-1 text-xs leading-snug">{t("land.how.agent.sub")}</div>
            </div>
            <FlowArrow />
            {/* Le nœud central se distingue par le PAPIER, pas par un lavis. Le
                lavis empilé sous du cuivre était mesurable : `--copper-wash`
                par-dessus `--paper-warm` donne rgb(244, 228.3, 221.8), sur
                lequel `--copper-deep` (la valeur de `--copper-text` en bande
                claire) ne tenait que 4.21:1 — sous le plancher 4.5:1 — et la
                pastille, qui empilait un SECOND lavis, 3.80:1. Le site produit
                exactement cet arbitrage : `.section--light .dg-node` (2 classes)
                l'emporte sur `.dg-node--hot` (1 classe), si bien qu'en bande
                claire le nœud chaud de son schéma perd son remplissage cuivre et
                repasse en `var(--paper)`, ne gardant que le filet. Le blanc
                remonte le sous-titre à 5.19:1 et la pastille à 4.62:1. */}
            <div className="relative flex-1 rounded-2xl border border-[color:var(--copper-line)] bg-[color:var(--paper)] p-6 text-center">
              <div className="mx-auto mb-2 grid h-9 w-9 place-items-center rounded-xl bg-[color:var(--copper-wash)] text-[color:var(--copper-text)] ring-1 ring-[color:var(--copper-line)]">
                <ShieldMark className="h-5 w-5" />
              </div>
              <div className="text-sm font-bold text-[color:var(--text-hi)]">
                {t("land.how.guard")}
              </div>
              <div className="mt-1 text-xs font-medium text-[color:var(--copper-text)]">
                {t("land.how.guard.sub")}
              </div>
            </div>
            <FlowArrow />
            <div className="card flex-1 p-6 text-center">
              <div className="text-sm font-semibold text-[color:var(--text-hi)]">
                {t("land.how.tools")}
              </div>
              <div className="muted mt-1 text-xs leading-snug">{t("land.how.tools.sub")}</div>
            </div>
          </div>

          {/* 3 steps */}
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            {STEPS.map(([title, body], i) => (
              <div key={title} className="card reveal p-6" data-delay={String(i + 1)}>
                <h3 className="t-h3">{t(title)}</h3>
                <p className="muted mt-1.5 text-sm leading-relaxed">{t(body)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Le paysage des menaces (L4) : ce dont on parle, classé, en clair.
          Distinct du relevé (L5) plus haut, qui dit ce que la passerelle bloque et
          le prouve. Cette section ne revendique rien ; `lib/menaces.ts` explique
          pourquoi la frontière entre les deux est tenue. */}
      <section className="section">
        <div className="wrap">
          <div className="text-center">
            <p className="eyebrow" data-num="05">
              {t("land.menace.kicker")}
            </p>
            <h2 className="t-h2 mt-2" data-sheen>
              {t("land.menace.title")}
            </h2>
            <p className="lead mx-auto mt-4">{t("land.menace.lead")}</p>
          </div>

          {/* La chaîne d'attaque : la légende des pastilles, montrée une seule fois. */}
          <figure className="reveal mt-12" data-delay="1">
            <ol className="chaine__voie">
              {ETAPES.map((etape, i) => (
                <li
                  key={etape}
                  className="chaine__etape"
                  data-tenu={etape === "actions" ? "true" : undefined}
                >
                  <Points actif={i} />
                  <span className="chaine__nom">{t(cleEtape(etape))}</span>
                </li>
              ))}
            </ol>
            <figcaption className="muted mt-4 text-center text-sm">
              {t("land.menace.legend")}
            </figcaption>
          </figure>

          {/* `reveal` porte sur la liste et non sur chaque rangée : vingt-trois
              apparitions décalées feraient un défilé, pas une révélation. */}
          <ol className="paysage reveal mt-10" data-delay="2">
            {MENACES.map((m) => (
              <li key={m.rang} className="menace" data-critique={m.critique ? "true" : undefined}>
                <span className="menace__rang">{String(m.rang).padStart(2, "0")}</span>
                <h3 className="menace__titre">{t(cleTitre(m))}</h3>
                <p className="menace__clair">{t(cleClair(m))}</p>
                <div className="menace__meta">
                  {m.critique && <span className="menace__flag">{t("land.menace.critique")}</span>}
                  <span className="menace__etape">
                    <Points actif={ETAPES.indexOf(m.etape)} />
                    {t(cleEtape(m.etape))}
                  </span>
                  {m.releve && <span className="menace__releve">{m.releve}</span>}
                </div>
              </li>
            ))}
          </ol>

          <p className="muted mt-8 max-w-3xl text-sm leading-relaxed">{t("land.menace.note")}</p>
        </div>
      </section>

      {/* Compliance — l'aparté, en bande resserrée. Le panneau en dégradé cuivre
          disparaît : sur le site, le cuivre se concentre dans le seul bandeau final
          plutôt que de se disperser en fonds de section. */}
      <section className="section section--tight">
        <div className="wrap split">
          <div>
            <p className="eyebrow" data-num="06">
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
            <p className="eyebrow" data-num="07">
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
            <Link href="/login" className="btn btn-primary">
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
