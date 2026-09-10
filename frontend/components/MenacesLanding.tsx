"use client";

/**
 * Section 2 de l'accueil : le problème, groupé par maillon.
 *
 * Le classement complet vit sur `/evidence`, où il est confronté au relevé de
 * couverture et au profil du visiteur. Ici on répond à la question d'avant :
 * *de quoi parle-t-on ?* Vingt-trois menaces d'affilée feraient une section qu'on
 * fait défiler sans la lire, donc elles sont **groupées par maillon** et un seul
 * groupe est ouvert à la fois.
 *
 * L'entrée par défaut est « les plus coûteuses » plutôt que le premier maillon : un
 * lecteur qui ne clique jamais doit voir ce qui compte, pas ce qui vient en premier
 * dans l'ordre du trajet.
 *
 * **Cette section ne revendique aucune couverture.** Elle n'affiche ni identifiant de
 * relevé ni mode publié : ce sont eux qui transformeraient un paysage en promesse, et
 * ils appartiennent à la page qui les prouve. Le lien vers `/evidence` le dit en toutes
 * lettres sous la liste.
 */

import { useState } from "react";

import { Diagramme, DiagrammeDefs } from "@/components/Diagramme";
import type { GUARD_COPY } from "@/components/guard-copy";
import { useT } from "@/lib/i18n";
import {
  cleClair,
  cleEtape,
  cleTitre,
  ETAPES,
  MENACES,
  type Etape,
  type Menace,
} from "@/lib/menaces";
import { SCHEMAS } from "@/lib/schemas";

type Copy = (typeof GUARD_COPY)[keyof typeof GUARD_COPY];

/** `null` = le haut du classement, tous maillons confondus. */
type Groupe = Etape | null;

function Menace({ menace, copy }: { menace: Menace; copy: Copy }) {
  const { t } = useT();
  const corps = SCHEMAS[menace.rang];
  return (
    <li className="guard-threat" data-critique={menace.critique || undefined}>
      <div className="guard-threat__figure">
        {corps && <Diagramme corps={corps} />}
      </div>
      <div className="guard-threat__body">
        <p className="guard-threat__head">
          <span className="guard-threat__rank" aria-hidden="true">
            {String(menace.rang).padStart(2, "0")}
          </span>
          <strong>{t(cleTitre(menace))}</strong>
          {menace.critique && (
            <span className="guard-threat__flag">{copy.critical}</span>
          )}
        </p>
        <p className="guard-threat__plain">{t(cleClair(menace))}</p>
      </div>
    </li>
  );
}

export function MenacesLanding({ copy }: { copy: Copy }) {
  const { t } = useT();
  const [groupe, setGroupe] = useState<Groupe>(null);

  const retenues =
    groupe === null
      ? MENACES.filter((m) => m.critique)
      : MENACES.filter((m) => m.etape === groupe);

  return (
    <section
      id="menaces-accueil"
      className="guard-problem guard-wrap"
      aria-labelledby="problem-heading"
    >
      <DiagrammeDefs />
      <div className="guard-section-heading">
        <p className="guard-kicker">{copy.problemKicker}</p>
        <h2 id="problem-heading">{copy.problemTitle}</h2>
        <p>{copy.problemIntro}</p>
      </div>

      {/* Le groupe est un `<button>` et non un `<li>` cliquable : le rôle, le focus
          clavier et l'annonce de l'état pressé viennent alors du navigateur. Le compte
          reste affiché sur chaque bouton, donc un groupe fermé ne disparaît pas. */}
      <div
        className="guard-threat-groups"
        role="group"
        aria-label={copy.problemPick}
      >
        <button
          type="button"
          aria-pressed={groupe === null}
          onClick={() => setGroupe(null)}
        >
          {copy.problemTop}
          <span aria-hidden="true">
            {MENACES.filter((m) => m.critique).length}
          </span>
        </button>
        {ETAPES.map((etape) => (
          <button
            key={etape}
            type="button"
            aria-pressed={groupe === etape}
            onClick={() => setGroupe(etape)}
          >
            {t(cleEtape(etape))}
            <span aria-hidden="true">
              {MENACES.filter((m) => m.etape === etape).length}
            </span>
          </button>
        ))}
      </div>

      <p className="guard-threat-note" aria-live="polite">
        {groupe === null ? copy.problemTopNote : t(cleEtape(groupe))}
      </p>

      <ul className="guard-threats">
        {retenues.map((menace) => (
          <Menace key={menace.rang} menace={menace} copy={copy} />
        ))}
      </ul>

      <p className="guard-threat-scope">{copy.problemLinkNote}</p>
      <a className="guard-link" href="/evidence">
        {copy.problemLink}
        <span aria-hidden="true">↗</span>
      </a>
    </section>
  );
}
