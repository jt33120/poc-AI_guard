"use client";

/**
 * Section 3 de l'accueil : l'aiguillage.
 *
 * La page s'arrêtait jusqu'ici sur une adresse e-mail unique, quelle que soit la
 * personne qui la lisait. Un développeur seul n'écrit pas à une ESN pour brancher un
 * agent, et une direction ne crée pas un compte en ligne pour cadrer ses usages : la
 * même sortie renvoyait donc l'un et l'autre à côté.
 *
 * Deux chemins, donc, et chacun mène quelque part de différent : le conseil garde le
 * courriel, qui est la bonne porte pour une prestation ; le libre-service mène à la
 * page qui explique ce qu'on obtient sans nous parler.
 *
 * Ce n'est pas un formulaire. Rien n'est envoyé, rien n'est mesuré ici : le visiteur
 * choisit, et le lien fait le reste.
 */

import Link from "next/link";

import type { GUARD_COPY } from "@/components/guard-copy";

type Copy = (typeof GUARD_COPY)[keyof typeof GUARD_COPY];

const MAILTO =
  "mailto:julian.talou@xsom.fr?subject=xSOM%20AI%20Guard%20%3A%20cas%20d%E2%80%99usage";

export function Orientation({ copy }: { copy: Copy }) {
  return (
    <section
      id="vous"
      className="guard-who guard-wrap"
      aria-labelledby="who-heading"
    >
      <div className="guard-section-heading">
        <p className="guard-kicker">{copy.whoKicker}</p>
        <h2 id="who-heading">{copy.whoTitle}</h2>
        <p>{copy.whoIntro}</p>
      </div>

      <div className="guard-paths">
        {(["company", "builder"] as const).map((id) => {
          const path = copy.paths[id];
          return (
            <article key={id} className="guard-path" data-path={id}>
              <p className="guard-path__tag">{path.tag}</p>
              <h3>{path.title}</h3>
              <ul>
                {path.list.map((item) => (
                  <li key={item}>
                    <span aria-hidden="true">↗</span>
                    {item}
                  </li>
                ))}
              </ul>
              {id === "company" ? (
                <a className="guard-button" href={MAILTO}>
                  {path.action}
                  <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <Link className="guard-button" href="/saas">
                  {path.action}
                  <span aria-hidden="true">↗</span>
                </Link>
              )}
              <p className="guard-path__note">{path.note}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
