"use client";

/**
 * Le relevé des menaces (`L5`).
 *
 * Un **relevé**, pas une grille de cartes : seize rangées séparées d'un filet, numéro
 * en mono cuivre dans une gouttière fixe, mode publié entre crochets. C'est la forme
 * d'un document technique, et c'est le parti pris du chantier — la grille de cartes à
 * ombre douce est précisément ce que le brief refuse.
 *
 * **D'où viennent les données**, et la frontière est la règle :
 *
 * * les lignes, leurs facettes, le mode publié et la classification d'ouverture
 *   viennent de `lib/threats.ts`, artefact généré depuis `coverage/map.json` et gaté
 *   en CI. Ils ne dépendent d'aucun visiteur, donc ils sont là au premier rendu, sans
 *   appel réseau, et un robot les voit ;
 * * l'applicabilité, le plafond de profil et **tous les comptes** viennent de
 *   `/api/threats`, donc de `core.triage`. Les recalculer ici donnerait un second
 *   moteur, et le premier désaccord entre les deux se lirait sur une page commerciale.
 *   L'écart n'est pas théorique : sur `P1a`, la carte compte 3 facettes bloquées et
 *   2 lignes bloquées.
 *
 * Si l'appel échoue, la section **ne se vide pas** : elle montre le relevé publié en
 * disant qu'il n'est pas positionné. Une liste vide se lirait « aucune menace ».
 */

import { useState } from "react";

import { useT, type StrKey } from "@/lib/i18n";
import { FAITS_PUBLIES } from "@/lib/facts";
import { PROFILS, useProfils } from "@/components/ProfilContext";
import { ReplayPanel } from "@/components/ReplayPanel";
import { rejeuDe } from "@/lib/replays";
import { RELEVE, type LigneMenace, type ReleveProfil } from "@/lib/threats";

const MODE_LABEL: Record<string, StrKey> = {
  B: "ledger.mode.B",
  D: "ledger.mode.D",
  O: "ledger.mode.O",
  A: "ledger.mode.A",
  X: "ledger.mode.X",
  NA: "ledger.mode.NA",
};

const MODE_DEF: Record<string, StrKey> = {
  B: "ledger.mode.B.def",
  D: "ledger.mode.D.def",
  O: "ledger.mode.O.def",
  A: "ledger.mode.A.def",
  X: "ledger.mode.X.def",
};

const INGRESS_LABEL: Record<string, StrKey> = {
  mcp: "ledger.ingress.mcp",
  http: "ledger.ingress.http",
  llm_proxy: "ledger.ingress.llm_proxy",
};

/** Le mode le plus fort qu'une ligne publie : c'est lui qui la qualifie d'un coup d'œil. */
const FORCE: Record<string, number> = { B: 4, D: 3, O: 2, A: 1, X: 0, NA: -1 };

/**
 * La vue à afficher pour une rangée : celle du visiteur, ou celle publiée.
 *
 * **Une seule décision, à un seul endroit**, et c'est délibéré : elle était prise deux
 * fois — une pour le mode, une pour les facettes retenues — et deux copies d'une même
 * règle finissent par diverger. Ce lot existe précisément parce que compter deux fois
 * la même chose de deux façons donne deux réponses.
 *
 * Sur une ligne **applicable**, on montre ce que le moteur retient : les facettes du
 * visiteur, aux modes déjà plafonnés par son profil (`FR-174`), et la preuve qui va
 * avec. Sur une ligne qui n'est pas la sienne, le moteur ne retient rien, et on montre
 * la vue publiée entière. Jamais un mélange : un mode publié à côté d'un chemin
 * d'entrée vidé se contredit à l'œil nu.
 */
function vueDeLaRangee(
  ligne: LigneMenace,
  positionne: ReleveProfil | undefined,
): { facettes: LigneMenace["facettes"]; modes: string[]; applicable: boolean; owner?: string } {
  const moteur = positionne?.rows.find((r) => r.id === ligne.id);
  if (moteur?.applicable && moteur.facets.length) {
    const cles = new Set(moteur.facets.map((f) => f.cle));
    return {
      facettes: ligne.facettes.filter((f) => cles.has(f.cle)),
      modes: moteur.facets.map((f) => f.mode),
      applicable: true,
      owner: moteur.owner,
    };
  }
  return {
    facettes: ligne.facettes,
    modes: ligne.facettes.map((f) => f.mode),
    applicable: false,
    owner: moteur?.owner,
  };
}

/** Le mode le plus fort d'un jeu de modes : c'est lui qui qualifie la rangée. */
function modeLePlusFort(modes: string[]): string {
  return modes.reduce((a, b) => ((FORCE[b] ?? -1) > (FORCE[a] ?? -1) ? b : a), "NA");
}

/**
 * La densité de preuve, en barres.
 *
 * Un relevé se lit d'un coup d'œil ; un chiffre se lit ligne à ligne. Les barres disent
 * la même chose que « 4 scénarios » sans obliger à comparer des nombres de rangée en
 * rangée. Elles ne sont pas une note : une ligne `Hors périmètre` n'a rien à prouver et
 * son absence de barre n'est pas un reproche.
 */
function Densite({ scenarios }: { scenarios: number }) {
  // Rien plutôt que cinq barres vides. Une ligne `Hors périmètre` n'a rien à prouver,
  // et cinq creux à côté de son titre se lisent comme une note de zéro — exactement le
  // reproche que ce relevé ne fait pas. L'absence de barre est neutre ; une rangée de
  // vides ne l'est pas.
  if (scenarios === 0) return null;
  const plein = Math.min(scenarios, 5);
  return (
    <span aria-hidden="true" className="font-mono text-[length:var(--fs-label)] tracking-[0.2em]">
      <span className="text-brand-bright">{"|".repeat(plein)}</span>
      {/* Les creux restent volontairement au ras du seuil, sur `--border-mid`
          (1.50:1 sur `--ink-900`) et non sur un jeton de texte. Ce sont des
          **graduations, pas une valeur** : toute l'information de la jauge est
          portée par les barres pleines, en `--copper-sheen` à 8.85:1, et le même
          compte est publié en toutes lettres dans l'ouverture de la rangée. Un
          lecteur qui ne voit pas les creux ne perd rien ; les monter à 4.5:1 les
          mettrait à égalité visuelle avec les pleines et rendrait la jauge
          illisible — précisément la « note de zéro » que le commentaire ci-dessus
          refuse. `--border-mid` plutôt que `white/15` (1.55:1, valeur identique à
          l'œil) parce qu'une opacité brute disparaît sous `.section--light`
          (1.02:1) là où le jeton s'y réécrit et garde ses 1.50:1. */}
      <span className="text-[color:var(--border-mid)]">{"|".repeat(5 - plein)}</span>
    </span>
  );
}

function Mode({ mode }: { mode: string }) {
  const { t } = useT();
  const fort = mode === "B";
  return (
    // `.label` porte la forme du troisième rôle typographique (mono, capitales,
    // `--fs-label`, interlettrage .14em de la charte) au lieu de la recomposer à
    // la main : `tracking-wider` valait .05em, soit un tiers de l'espacement du
    // site. La couleur, elle, est surchargée : le mode est une colonne de données,
    // pas une légende, et `--text-low` (5.58:1) lui donne la marge que
    // `text-white/45` (4.48:1, sous le plancher) ne donnait pas.
    <span
      className={`label whitespace-nowrap ${
        fort ? "text-brand-bright" : "text-[color:var(--text-low)]"
      }`}
    >
      [&nbsp;{mode}&nbsp;] {t(MODE_LABEL[mode] ?? "ledger.mode.NA")}
    </span>
  );
}

function Rangee({
  ligne,
  positionne,
  ouverte,
  basculer,
}: {
  ligne: LigneMenace;
  positionne?: ReleveProfil;
  ouverte: boolean;
  basculer: () => void;
}) {
  const { t } = useT();
  const vue = vueDeLaRangee(ligne, positionne);
  const applicable = vue.applicable;
  const mode = modeLePlusFort(vue.modes);
  const retenues = vue.facettes;

  const scenarios = [...new Set(retenues.flatMap((f) => f.scenarios))];
  const ingress = [...new Set(retenues.flatMap((f) => f.ingress_prouve))];
  const ecarts = [...new Set(retenues.flatMap((f) => f.ecarts))];

  return (
    <div
      className={`border-t border-[color:var(--border)] transition-colors ${
        // Une ligne qui ne concerne pas le visiteur est **estompée, jamais cachée** :
        // le relevé complet est l'argument, et masquer les six lignes qui ne sont pas
        // les siennes reviendrait à vendre les quinze du marché en silence.
        //
        // `row--aside` et non `opacity-45` : l'opacité de conteneur se multiplie sur
        // tous les descendants et faisait tomber le titre à 4.16:1. La classe
        // redéfinit les jetons contextuels, ce qui estompe sans passer sous le
        // plancher — voir son commentaire dans `globals.css`.
        positionne && !applicable ? "row--aside" : ""
      }`}
    >
      <button
        type="button"
        onClick={basculer}
        aria-expanded={ouverte}
        className="group grid w-full grid-cols-[3.5rem_1fr_auto] items-baseline gap-x-4 px-1 py-4 text-left hover:bg-[color:var(--surface)] sm:grid-cols-[4rem_1fr_auto_auto] sm:gap-x-6"
      >
        <span className="font-mono text-xs text-[color:var(--copper-text)]">{ligne.id}</span>

        <span className="min-w-0">
          <span className="font-display text-base font-semibold leading-snug text-[color:var(--text-hi)] sm:text-lg">
            {ligne.titre}
          </span>
          {ingress.length > 0 && (
            <span className="muted mt-1 block font-mono text-[length:var(--fs-label)]">
              {t("ledger.ingress.label")} {ingress.map((i) => t(INGRESS_LABEL[i] ?? "ledger.ingress.mcp")).join(" · ")}
            </span>
          )}
          {ingress.length === 0 && (
            <span className="muted mt-1 block font-mono text-[length:var(--fs-label)]">
              {t("ledger.ingress.none")}
            </span>
          )}
        </span>

        <span className="hidden sm:block">
          <Densite scenarios={scenarios.length} />
        </span>

        <Mode mode={mode} />
      </button>

      {ouverte && (
        <div className="grid gap-4 px-1 pb-6 sm:grid-cols-[4rem_1fr] sm:gap-x-6">
          <div aria-hidden="true" />
          <div className="max-w-3xl space-y-4">
            <p className="muted text-sm leading-relaxed">{t(MODE_DEF[mode] ?? "ledger.mode.A.def")}</p>

            <Ouverture ligne={ligne} scenarios={scenarios} retenues={retenues} />

            {positionne && (
              <p className="label text-[color:var(--text-low)]">
                {applicable
                  ? t("ledger.owner.mine")
                  : `${t("ledger.owner.not")} · ${vue.owner ?? ""}`}
              </p>
            )}

            {ecarts.length > 0 && (
              <p className="muted font-mono text-[length:var(--fs-label)]">
                {t("ledger.open.gaps")} : {ecarts.join(" · ")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Le contenu de l'ouverture, choisi par la classification que `core` a dérivée. */
function Ouverture({
  ligne,
  scenarios,
  retenues,
}: {
  ligne: LigneMenace;
  scenarios: string[];
  //: les facettes que le moteur retient pour ce visiteur, ou toutes hors positionnement
  retenues: LigneMenace["facettes"];
}) {
  const { t } = useT();
  // La raison affichée est celle des facettes retenues : publier la raison d'une
  // facette qu'on n'a pas répondrait à une question que personne n'a posée.
  const raisons = retenues.map((f) => f.raison).filter((r): r is string => Boolean(r));

  if (ligne.ouverture === "rejeu") {
    return (
      <div className="space-y-4">
        <p className="muted text-sm leading-relaxed">{t("ledger.open.rejeu.b")}</p>
        {/* Le rejeu lui-même : deux traces d'audit réelles, côte à côte. Le gate de
            `L6` exige qu'il existe pour chaque ligne rejouable, si bien que cette
            branche ne peut pas s'ouvrir sur du vide. */}
        <ReplayPanel rowId={ligne.id} rejeu={rejeuDe(ligne.id)} />
        <Scenarios scenarios={scenarios} />
      </div>
    );
  }

  if (ligne.ouverture === "scenario") {
    return (
      <div className="space-y-3">
        <h4 className="font-display text-sm font-bold text-brand-bright">
          {t("ledger.open.scenario.t")}
        </h4>
        <p className="muted text-sm leading-relaxed">{t("ledger.open.scenario.b")}</p>
        <Scenarios scenarios={scenarios} />
      </div>
    );
  }

  if (ligne.ouverture === "raison") {
    return (
      <div className="space-y-3">
        <h4 className="font-display text-sm font-bold text-brand-bright">
          {t("ledger.open.raison.t")}
        </h4>
        {/* La raison est **publiée dans la carte**, pas rédigée ici : `FR-144` exige
            que la ligne non couverte le soit avec sa raison. */}
        {raisons.map((raison) => (
          <p key={raison} className="muted text-sm leading-relaxed">
            {raison}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="font-display text-sm font-bold text-brand-bright">
        {t("ledger.open.attestation.t")}
      </h4>
      <p className="muted text-sm leading-relaxed">{t("ledger.open.attestation.b")}</p>
    </div>
  );
}

function Scenarios({ scenarios }: { scenarios: string[] }) {
  const { t } = useT();
  if (scenarios.length === 0) return null;
  return (
    <div>
      {/* `.label` seule : elle pose déjà `--text-faint` (4.93:1). `text-white/40`
          l'écrasait à 3.80:1 sur du mono de 11.2 px en capitales espacées — le pire
          cas typographique de la page, et l'exacte opacité que l'en-tête de
          `globals.css` nomme comme déjà jugée non conforme. */}
      <p className="label mb-1.5">{t("ledger.open.scenarios")}</p>
      <ul className="space-y-1">
        {scenarios.map((s) => (
          <li key={s} className="muted break-all font-mono text-[length:var(--fs-label)] leading-relaxed">
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ThreatLedger() {
  const { t } = useT();
  const { choisis, basculer: basculerProfil, positionne, occupe, echoue } = useProfils();
  const [ouverte, setOuverte] = useState<string | null>(null);

  return (
    <section id="menaces" className="section scroll-mt-20">
      <div className="wrap">
        <p className="eyebrow" data-num="01">
          {t("ledger.kicker")}
        </p>
        <h2 className="t-h2 mt-2 max-w-3xl" data-sheen>
          {t("ledger.title", { lignes: FAITS_PUBLIES.faits.lignes })}
        </h2>
        <p className="lead mt-4">{t("ledger.lede")}</p>

        {/* Le sélecteur de profil. Le filet cuivre ouvre le bloc : sur `xsom.fr`
            (`base.css` l. 227) `.rule` **remplace** le séparateur gris, il ne s'y
            ajoute pas. Le filet bas du `border-y` disparaît avec lui — le relevé
            qui suit ouvre déjà sa première rangée sur un filet à lui, et deux
            traits à huit pixels d'écart n'en disaient qu'un. */}
        <hr className="rule mt-10" />
        <div className="pb-6">
          <p className="label">{t("ledger.profil.title")}</p>
          <p className="muted mt-1 text-sm">{t("ledger.profil.hint")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {PROFILS.map((p) => {
              const actif = choisis.includes(p.id);
              // `border-brand/60` et `bg-brand/15` n'émettaient **aucune règle** :
              // Tailwind ne sait pas appliquer un modificateur d'opacité à une
              // couleur qu'il ne peut pas décomposer (`var(--copper)`), défaut déjà
              // documenté pour `bg-navy/90` en tête de `globals.css`. La puce cochée
              // retombait donc sur le `border-color: #e5e7eb` du preflight — un
              // liseré gris clair à 14.64:1, ni cuivre ni discret, et sans lavis.
              // `--copper-text` (5.15:1) et `--copper-wash` sont le couple que
              // `.badge-blue` emploie déjà pour ce même rôle.
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => basculerProfil(p.id)}
                  aria-pressed={actif}
                  title={t(p.hint)}
                  className={`rounded-sm border px-3 py-1.5 text-left font-mono text-xs transition ${
                    actif
                      ? "border-[color:var(--copper-text)] bg-[color:var(--copper-wash)] text-brand-bright"
                      : "border-[color:var(--border-mid)] text-[color:var(--text-mid)] hover:border-[color:var(--copper-line)] hover:text-[color:var(--text-hi)]"
                  }`}
                >
                  <span className="text-[color:var(--copper-text)]">{p.id}</span> {t(p.label)}
                </button>
              );
            })}
          </div>

          <p className="muted mt-4 min-h-[1.5rem] text-sm" aria-live="polite">
            {occupe && t("ledger.profil.busy")}
            {!occupe && echoue && t("ledger.profil.failed")}
            {!occupe && !echoue && !positionne && t("ledger.profil.none")}
            {/* L'énoncé vient du moteur, mot pour mot. Le réécrire ici en ferait une
                seconde rédaction du même compte. */}
            {!occupe && !echoue && positionne?.statement}
          </p>

          {positionne?.cap && (
            // Même défaut qu'au-dessus : `border-brand/50` n'émettait rien et le
            // filet de l'encadré était gris (#e5e7eb). `border-left: 2px solid
            // var(--copper)` est la forme de l'encadré sur `xsom.fr`
            // (`components.css` l. 572 et 715) ; `--copper-text` en est la variante
            // contextuelle, qui passe en `--copper-deep` sous `.section--light`.
            <p className="muted mt-3 max-w-2xl border-l-2 border-[color:var(--copper-text)] pl-4 text-sm leading-relaxed">
              {t("ledger.cap")}
            </p>
          )}
        </div>

        {/* Le relevé. */}
        <div className="mt-2">
          {RELEVE.lignes.map((ligne) => (
            <Rangee
              key={ligne.id}
              ligne={ligne}
              positionne={positionne}
              ouverte={ouverte === ligne.id}
              basculer={() => setOuverte(ouverte === ligne.id ? null : ligne.id)}
            />
          ))}
          {/* Ce trait-ci **n'est pas** un ouvre-section, et il ne prend donc pas le
              filet cuivre : c'est le dix-septième filet d'une grille de seize
              rangées, celui qui ferme la dernière. En cuivre, la dernière rangée
              n'aurait pas le même bord bas que les quinze au-dessus, et un relevé
              dont la dernière ligne se compose autrement n'est plus un relevé. */}
          <div className="border-t border-[color:var(--border)]" />
        </div>

        <p className="muted mt-6 font-mono text-[length:var(--fs-label)]">
          {t("ledger.stamp", { date: RELEVE.genere_le, commit: RELEVE.commit })}
        </p>
      </div>
    </section>
  );
}
