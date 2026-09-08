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
import {
  cleClair,
  cleEtape,
  cleTitre,
  ETAPES,
  MENACES,
  type Etape,
  type Menace,
} from "@/lib/menaces";

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
      <span className="text-[color:var(--copper-text)]">{"|".repeat(plein)}</span>
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

/**
 * Les cinq points de la chaîne, celui de l'étape allumé.
 *
 * `aria-hidden` : le nom de l'étape est écrit en toutes lettres juste à côté, donc
 * le glyphe répète et n'informe pas. Un lecteur d'écran qui l'annoncerait ferait
 * entendre deux fois la même chose.
 */
function Points({ actif }: { actif: number }) {
  return (
    <svg viewBox="0 0 52 10" className="points" aria-hidden="true">
      <line className="points__voie" x1="5" y1="5" x2="47" y2="5" strokeWidth="1" />
      {ETAPES.map((etape, i) => (
        <circle
          key={etape}
          className={i === actif ? "points__point points__point--on" : "points__point"}
          cx={5 + i * 10.5}
          cy="5"
          r={i === actif ? 3.6 : 2}
        />
      ))}
    </svg>
  );
}

/**
 * Le schéma d'une rangée : où la menace entre dans la chaîne, et si elle est du
 * haut du classement.
 *
 * L'étiquette « critique » est écrite en toutes lettres et non seulement portée par
 * la graisse du titre : un signal typographique n'est pas annoncé par un lecteur
 * d'écran, et le haut du classement est précisément ce qu'il ne faut pas rater.
 */
function Schema({ etape, critique }: { etape: Etape; critique: boolean }) {
  const { t } = useT();
  return (
    <div className="menace__schema">
      {critique && <span className="menace__flag">{t("land.menace.critique")}</span>}
      <Points actif={ETAPES.indexOf(etape)} />
      <span className="menace__etape">{t(cleEtape(etape))}</span>
    </div>
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
        fort ? "text-[color:var(--copper-text)]" : "text-[color:var(--text-low)]"
      }`}
    >
      [&nbsp;{mode}&nbsp;] {t(MODE_LABEL[mode] ?? "ledger.mode.NA")}
    </span>
  );
}

function Rangee({
  ligne,
  menace,
  positionne,
  ouverte,
  basculer,
}: {
  ligne: LigneMenace;
  menace: Menace;
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
      className={`menace-bloc ${
        // Une ligne qui ne concerne pas le visiteur est **estompée, jamais cachée** :
        // le relevé complet est l'argument, et masquer les six lignes qui ne sont pas
        // les siennes reviendrait à vendre les quinze du marché en silence.
        //
        // `row--aside` et non `opacity-45` : l'opacité de conteneur se multiplie sur
        // tous les descendants et faisait tomber le titre à 4.16:1. La classe
        // redéfinit les jetons contextuels, ce qui estompe sans passer sous le
        // plancher.
        positionne && !applicable ? "row--aside" : ""
      }`}
    >
      <button
        type="button"
        onClick={basculer}
        aria-expanded={ouverte}
        className="menace"
        data-critique={menace.critique ? "true" : undefined}
      >
        <span className="menace__rang">{String(menace.rang).padStart(2, "0")}</span>

        <Schema etape={menace.etape} critique={menace.critique} />

        <span className="min-w-0">
          {/* Le titre passe par le dictionnaire et non par `ligne.titre`, alors même
              que la carte en porte un : l'artefact généré n'est qu'en français, et
              un visiteur anglophone lisait donc seize titres français au milieu de
              sa page. `tests/test_menaces_section.py` impose que la version
              française y soit celle de la carte, mot pour mot, si bien que passer
              par le dictionnaire n'ouvre aucun écart. */}
          <span className="menace__titre block">{t(cleTitre(menace))}</span>
          {/* La définition en clair vient du classement éditorial, pas de la carte :
              la carte prouve, elle n'explique pas. */}
          <span className="menace__clair block">{t(cleClair(menace))}</span>
          <span className="menace__releve mt-2 block">
            {ingress.length > 0
              ? `${t("ledger.ingress.label")} ${ingress
                  .map((i) => t(INGRESS_LABEL[i] ?? "ledger.ingress.mcp"))
                  .join(" · ")}`
              : t("ledger.ingress.none")}
          </span>
        </span>

        {/* Ce que le backend en tient : la question que la rangée existe pour
            trancher, donc la colonne qui la ferme. */}
        <span className="menace__couverture">
          <Mode mode={mode} />
          <Densite scenarios={scenarios.length} />
          <span className="menace__id">{ligne.id}</span>
        </span>
      </button>

      {ouverte && (
        <div className="grid gap-4 px-1 pb-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-x-6">
          <div aria-hidden="true" className="hidden lg:block" />
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

/**
 * Une menace que la carte de couverture n'évalue pas encore.
 *
 * Elle n'a ni mode, ni scénario, ni chemin d'entrée : elle ne peut donc pas
 * s'ouvrir, et sa colonne de droite le dit en toutes lettres plutôt que de rester
 * vide. Un blanc à la place d'un mode se lirait comme « rien à signaler », qui est
 * l'inverse de ce qu'il faut comprendre.
 *
 * Ces sept lignes ne sont pas un oubli : la carte n'admet une revendication que
 * prouvée par scénario, et les inscrire sans preuve serait exactement l'affirmation
 * que `AD-30` interdit.
 */
function RangeeHorsCarte({ menace }: { menace: Menace }) {
  const { t } = useT();
  return (
    <div className="menace-bloc">
      <div className="menace" data-critique={menace.critique ? "true" : undefined}>
        <span className="menace__rang">{String(menace.rang).padStart(2, "0")}</span>
        <Schema etape={menace.etape} critique={menace.critique} />
        <span className="min-w-0">
          <span className="menace__titre block">{t(cleTitre(menace))}</span>
          <span className="menace__clair block">{t(cleClair(menace))}</span>
        </span>
        <span className="menace__couverture">
          <span className="label whitespace-nowrap text-[color:var(--text-low)]">
            {t("ledger.horscarte")}
          </span>
        </span>
      </div>
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
        <h4 className="font-display text-sm font-bold text-[color:var(--copper-text)]">
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
        <h4 className="font-display text-sm font-bold text-[color:var(--copper-text)]">
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
      <h4 className="font-display text-sm font-bold text-[color:var(--copper-text)]">
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
    // Bande claire, et plus large que le reste de la page : c'est la section qu'on
    // lit vraiment. Les jetons employés plus bas sont tous contextuels, donc la
    // bascule ne demande aucune substitution de couleur au point d'usage.
    <section id="menaces" className="section section--light scroll-mt-20">
      <div className="wrap wrap--wide">
        <p className="eyebrow" data-num="01">
          {t("ledger.kicker")}
        </p>
        <h2 className="t-h2 mt-2 max-w-3xl" data-sheen>
          {t("ledger.title")}
        </h2>
        <p className="lead mt-4 max-w-4xl">
          {t("ledger.lede", { lignes: FAITS_PUBLIES.faits.lignes })}
        </p>

        {/* La chaîne d'attaque : la légende des pastilles, montrée une seule fois.
            Sans elle, le glyphe de chaque rangée serait décoratif ; avec elle, il
            situe la menace dans un trajet que le lecteur a déjà vu. */}
        <figure className="mt-10">
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
          <figcaption className="muted mt-3 text-sm">{t("ledger.chaine")}</figcaption>
        </figure>

        {/* Le sélecteur de profil. Le filet cuivre ouvre le bloc : sur `xsom.fr`
            (`base.css` l. 227) `.rule` **remplace** le séparateur gris, il ne s'y
            ajoute pas. */}
        <hr className="rule mt-10" />
        <div className="pb-6">
          <p className="label">{t("ledger.profil.title")}</p>
          <p className="muted mt-1 text-sm">{t("ledger.profil.hint")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {PROFILS.map((p) => {
              const actif = choisis.includes(p.id);
              // `border-brand/60` et `bg-brand/15` n'émettaient **aucune règle** :
              // Tailwind ne sait pas appliquer un modificateur d'opacité à une
              // couleur qu'il ne peut pas décomposer (`var(--copper)`). La puce
              // cochée retombait sur le `border-color: #e5e7eb` du preflight.
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => basculerProfil(p.id)}
                  aria-pressed={actif}
                  title={t(p.hint)}
                  className={`rounded-sm border px-3 py-1.5 text-left font-mono text-xs transition ${
                    actif
                      ? "border-[color:var(--copper-text)] bg-[color:var(--paper)] text-[color:var(--copper-text)]"
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
            <p className="muted mt-3 max-w-2xl border-l-2 border-[color:var(--copper-text)] pl-4 text-sm leading-relaxed">
              {t("ledger.cap")}
            </p>
          )}
        </div>

        {/* Le relevé, dans l'ordre du classement et non dans celui des
            identifiants : le lecteur qui s'arrête à la cinquième rangée doit avoir
            lu les cinq qui comptent, pas `M-01` à `M-05`. */}
        <ol className="paysage mt-2">
          {MENACES.map((menace) => {
            const ligne = menace.releve
              ? RELEVE.lignes.find((l) => l.id === menace.releve)
              : undefined;
            return (
              <li key={menace.rang}>
                {ligne ? (
                  <Rangee
                    ligne={ligne}
                    menace={menace}
                    positionne={positionne}
                    ouverte={ouverte === ligne.id}
                    basculer={() => setOuverte(ouverte === ligne.id ? null : ligne.id)}
                  />
                ) : (
                  <RangeeHorsCarte menace={menace} />
                )}
              </li>
            );
          })}
        </ol>

        <p className="muted mt-6 max-w-4xl text-sm leading-relaxed">{t("ledger.note")}</p>
        <p className="muted mt-3 font-mono text-[length:var(--fs-label)]">
          {t("ledger.stamp", { date: RELEVE.genere_le, commit: RELEVE.commit })}
        </p>
      </div>
    </section>
  );
}
