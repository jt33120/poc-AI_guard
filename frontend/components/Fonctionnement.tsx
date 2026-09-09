import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ShieldMark } from "@/components/brand";
import { mcpConfig, snippet } from "@/lib/integration";
import { serverT } from "@/lib/lang";
import type { StrKey } from "@/lib/strings";

/**
 * « Comment ça marche », en une seule section (`L9`).
 *
 * Deux surfaces disaient la même chose à deux endroits : une section d'accueil qui
 * montrait le principe (agent → passerelle → outils), et une page `/mise-en-oeuvre`
 * qui montrait le branchement. Le visiteur devait quitter la page pour finir de
 * comprendre, et repartait rarement. Elles sont fondues ici, dans l'ordre où la
 * question se pose vraiment :
 *
 * 1. **le principe** — où la passerelle se place, et ce qu'elle fait de chaque appel ;
 * 2. **la preuve** — le rejeu d'une exécution réelle, pas une maquette ;
 * 3. **le branchement** — les trois voies d'entrée, dans l'ordre de garantie.
 *
 * **Sur la bande claire.** La page d'origine était sombre et écrivait ses teintes en
 * dur (`border-white/10`, `bg-black/30`, `text-white/75`). Portées telles quelles
 * ici, elles auraient rendu le texte invisible sur le papier. Tout passe donc par les
 * jetons contextuels, que `.section--light` réécrit : la section bascule avec sa
 * bande au lieu de dépendre de celle où elle a été dessinée.
 */

/**
 * La transcription de `make demo`, lue à la construction depuis l'artefact que
 * `scripts/record_demo.py` produit en même temps que la capture animée.
 *
 * Lecture au build et non `fetch` au rendu : les deux fichiers sortent de la même
 * exécution, et les séparer dans le temps laisserait la page afficher une capture
 * d'un run et le texte d'un autre. L'absence du fichier fait échouer la
 * construction, ce qui est le bon comportement — `AD-26` retire la capture quand
 * la démonstration casse, et une page qui se construirait quand même annoncerait
 * une preuve qu'elle n'a pas.
 */
const TRANSCRIPTION_DEMO = readFileSync(
  join(process.cwd(), "public", "demo-replay.txt"),
  "utf8",
).trimEnd();

/**
 * Les valeurs fictives des extraits publics.
 *
 * Un jeton visible sur une page publique doit **se voir** comme fictif : un
 * paramètre qui ressemble à un vrai jeton finit collé tel quel, et le premier appel
 * échoue sans que personne comprenne pourquoi.
 */
const JETON_FICTIF = "<votre-jeton-de-passerelle>";
const API_FICTIVE = "https://api.votre-deploiement.example";

const ETAPES: [StrKey, StrKey][] = [
  ["land.how.s1.t", "land.how.s1.b"],
  ["land.how.s2.t", "land.how.s2.b"],
  ["land.how.s3.t", "land.how.s3.b"],
];

function FlecheFlux() {
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

/**
 * Une voie d'entrée : ce qu'elle garantit, et ce qu'on colle.
 *
 * Trois colonnes plutôt que trois blocs empilés pleine largeur : la garantie est ce
 * qui les distingue, et on ne compare pas trois choses qu'il faut faire défiler l'une
 * après l'autre. L'extrait est replié — il sert à celui qui a déjà choisi, et déplié
 * par défaut il transformait la section en mur de code.
 */
function Voie({
  numero,
  titre,
  garantie,
  corps,
  note,
  code,
  langue,
}: {
  numero: number;
  titre: string;
  garantie: string;
  corps: string;
  note?: string;
  code: string;
  langue: string;
}) {
  const { t } = serverT();
  return (
    <div className="card flex flex-col p-6">
      <span className="font-mono text-sm text-[color:var(--copper-text)]">
        {String(numero).padStart(2, "0")}
      </span>
      <h4 className="t-h3 mt-2">{titre}</h4>
      <p className="mt-2 font-mono text-[11px] uppercase leading-relaxed tracking-wider text-[color:var(--copper-text)]">
        {t("mise.garantie")} · {garantie}
      </p>
      <p className="muted mt-3 text-sm leading-relaxed">{corps}</p>
      {note && (
        <p className="mt-3 border-l-2 border-[color:var(--border-mid)] pl-3 text-sm leading-relaxed text-[color:var(--text-low)]">
          {note}
        </p>
      )}
      <details className="mt-auto pt-6">
        <summary className="label cursor-pointer text-[color:var(--copper-text)]">
          {t("mise.livre")} · {langue}
        </summary>
        {/* `overflow-x-auto` plutôt qu'un retour à la ligne : un extrait recassé
            n'est plus copiable, et c'est sa seule fonction. */}
        <pre className="mt-3 overflow-x-auto rounded border border-[color:var(--border)] bg-[color:var(--surface-up)] p-4 font-mono text-[11px] leading-relaxed text-[color:var(--text-mid)]">
          {code}
        </pre>
      </details>
    </div>
  );
}

export function Fonctionnement() {
  const { t } = serverT();
  return (
    <section id="how" className="section section--light scroll-mt-20">
      {/* 1 — Le principe. Les trois blocs partagent `wrap--wide` : deux largeurs
          dans une même section donnent deux bords gauches, et l'œil lit le
          décalage comme une erreur plutôt que comme une intention. */}
      <div className="wrap wrap--wide">
        <div className="text-center">
          <p className="eyebrow" data-num="04">
            {t("land.how.kicker")}
          </p>
          <h2 className="t-h2 mt-2" data-sheen>
            {t("land.how.title")}
          </h2>
        </div>

        <div className="mt-12 flex flex-col items-stretch justify-center gap-3 md:flex-row md:items-center">
          <div className="card flex-1 p-6 text-center">
            <div className="text-sm font-semibold text-[color:var(--text-hi)]">
              {t("land.how.agent")}
            </div>
            <div className="muted mt-1 text-xs leading-snug">
              {t("land.how.agent.sub")}
            </div>
          </div>
          <FlecheFlux />
          {/* Le nœud central se distingue par le PAPIER, pas par un lavis. Le
              lavis empilé sous du cuivre était mesurable : `--copper-wash`
              par-dessus `--paper-warm` donne rgb(244, 228.3, 221.8), sur
              lequel `--copper-deep` (la valeur de `--copper-text` en bande
              claire) ne tenait que 4.21:1 — sous le plancher 4.5:1 — et la
              pastille, qui empilait un SECOND lavis, 3.80:1. Le blanc remonte
              le sous-titre à 5.19:1 et la pastille à 4.62:1. */}
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
          <FlecheFlux />
          <div className="card flex-1 p-6 text-center">
            <div className="text-sm font-semibold text-[color:var(--text-hi)]">
              {t("land.how.tools")}
            </div>
            <div className="muted mt-1 text-xs leading-snug">
              {t("land.how.tools.sub")}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {ETAPES.map(([titre, corps], i) => (
            <div
              key={titre}
              className="card reveal p-6"
              data-delay={String(i + 1)}
            >
              <h3 className="t-h3">{t(titre)}</h3>
              <p className="muted mt-1.5 text-sm leading-relaxed">{t(corps)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 2 — La preuve. La capture est le seul endroit du site où l'on voit le
          produit s'exécuter ; elle mérite la pleine largeur, pas une vignette. */}
      <div className="wrap wrap--wide mt-24">
        <figure className="card p-6 sm:p-8">
          <figcaption>
            <h3 className="t-h3">{t("mise.demo.t")}</h3>
            <p className="lead mt-2 max-w-3xl">{t("mise.demo.b")}</p>
          </figcaption>
          {/* `<img>` et non un SVG inline : le fichier est servi une fois, mis en
              cache, et reste isolé du document — ses règles d'animation ne peuvent
              pas fuir dans la page, ni la page les écraser. Le SVG porte sa propre
              neutralisation sous `prefers-reduced-motion`.
              `next/image` ne peut pas optimiser un SVG (même motif que
              `components/brand.tsx`) : la règle est levée ici aussi. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/demo-replay.svg"
            alt={t("mise.demo.t")}
            className="mt-6 w-full overflow-x-auto rounded"
          />
          <details className="mt-4">
            <summary className="label cursor-pointer text-[color:var(--copper-text)]">
              {t("mise.demo.txt")}
            </summary>
            <pre className="mt-3 overflow-x-auto rounded border border-[color:var(--border)] bg-[color:var(--surface-up)] p-4 font-mono text-xs leading-relaxed text-[color:var(--text-mid)]">
              {TRANSCRIPTION_DEMO}
            </pre>
          </details>
        </figure>
      </div>

      {/* 3 — Le branchement. L'ordre est le propos : la passerelle exécute ou
          n'exécute pas, `/v1/authorize` rend un verdict que l'agent décide
          d'honorer. Les présenter comme équivalentes vendrait la voie coopérative
          au prix de la contraignante, et `tests/test_integration_snippets.py`
          refuse la construction si l'ordre bouge. */}
      <div className="wrap wrap--wide mt-24">
        <h3 className="t-h2 max-w-3xl" data-sheen>
          {t("mise.title")}
        </h3>
        <p className="lead mt-4 max-w-2xl">{t("mise.lede")}</p>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          <Voie
            numero={1}
            titre={t("mise.mcp.t")}
            garantie={t("mise.mcp.g")}
            corps={t("mise.mcp.b")}
            note={t("mise.mcp.note")}
            code={mcpConfig(JETON_FICTIF)}
            langue="JSON"
          />
          <Voie
            numero={2}
            titre={t("mise.http.t")}
            garantie={t("mise.http.g")}
            corps={t("mise.http.b")}
            code={snippet("http", JETON_FICTIF, API_FICTIVE)}
            langue="Python"
          />
          <Voie
            numero={3}
            titre={t("mise.proxy.t")}
            garantie={t("mise.proxy.g")}
            corps={t("mise.proxy.b")}
            code={snippet("openai", JETON_FICTIF, API_FICTIVE)}
            langue="Python"
          />
        </div>

        <div className="mt-10 border-t border-[color:var(--border)] pt-8">
          <p className="muted max-w-2xl text-sm leading-relaxed">
            {t("mise.jeton")}
          </p>
          <p className="muted mt-3 max-w-2xl text-sm leading-relaxed">
            {t("mise.identique")}
          </p>
        </div>
      </div>
    </section>
  );
}
