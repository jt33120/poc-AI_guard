"use client";

/**
 * « Pour qui » (`L7`) — et, tout aussi clairement, pour qui ce n'est pas.
 *
 * Pas une liste de secteurs, pas de logos, pas de « ils nous font confiance » sans
 * clients à nommer. Le brief demandait que les grands comptes **se sentent
 * concernés** : on obtient cela en leur montrant leur propre relevé, pas une plaquette
 * qui les décrit.
 *
 * Ce que cette section ajoute au relevé de `L5`, et qui n'y était pas : **les
 * bascules**. `L5` dit ce qui vous concerne aujourd'hui ; ici on dit ce qui
 * *deviendrait* le vôtre, et à quelle condition. « Le piratage d'agents autonomes
 * devient votre ligne le jour où vous outillez vos agents » est une date dans une
 * feuille de route, pas un scénario inventé — et c'est `core.triage` qui la calcule,
 * pas cette page.
 *
 * Le plafond `P1b` est publié comme un argument, pas comme une réserve. Un produit de
 * gouvernance qui prétendrait superviser un assistant encastré dans une suite SaaS se
 * contredirait : il n'y a aucune frontière d'outils où s'interposer. `FR-174` le
 * calcule plutôt que de le laisser à la rédaction, précisément pour qu'aucune
 * formulation ne puisse le contourner.
 */

import { PROFILS, useProfils } from "@/components/ProfilContext";
import { useT } from "@/lib/i18n";

/**
 * Les profils sur lesquels le déploiement interdit de bloquer.
 *
 * Lu depuis la réponse du moteur (`cap`), jamais listé ici : `FR-174` vit dans
 * `core/profiles.py`, et une seconde liste côté page finirait par en différer le jour
 * où un profil s'ajoute.
 */
/** Ce qui n'est pas encore la vôtre, et la condition qui la ferait basculer. */
function Bascules() {
  const { t } = useT();
  const { positionne, choisis } = useProfils();

  const bascules = (positionne?.rows ?? []).filter(
    (r) => !r.applicable && r.activates_at.length > 0,
  );

  return (
    // Le filet cuivre ouvre le bloc à la place du `border-t` neutre : sur
    // `xsom.fr` (`base.css` l. 227) `.rule` **remplace** les séparateurs gris.
    <div className="mt-10">
      <hr className="rule mb-8" />
      <h3 className="t-h3">{t("pourqui.bascules.t")}</h3>
      <p className="muted mt-2 max-w-2xl text-sm leading-relaxed">{t("pourqui.bascules.b")}</p>

      {choisis.length === 0 && (
        <p className="muted mt-5 text-sm">{t("pourqui.bascules.vide")}</p>
      )}
      {choisis.length > 0 && bascules.length === 0 && (
        <p className="muted mt-5 text-sm">{t("pourqui.bascules.aucune")}</p>
      )}

      {bascules.length > 0 && (
        <ul className="mt-5">
          {bascules.map((r) => (
            <li
              key={r.id}
              className="grid grid-cols-[3.5rem_1fr] gap-x-4 border-t border-[color:var(--border)] py-3 sm:grid-cols-[4rem_1fr] sm:gap-x-6"
            >
              <span className="font-mono text-xs text-[color:var(--copper-text)]">{r.id}</span>
              <span className="min-w-0">
                <span className="block font-display text-base font-semibold text-[color:var(--text-hi)]">
                  {r.titre}
                </span>
                <span className="muted mt-1 block font-mono text-[length:var(--fs-label)]">
                  {t("pourqui.bascules.le")}{" "}
                  {/* Les profils déclencheurs viennent du moteur : c'est lui qui sait
                      quelle facette de quelle ligne concerne quel usage. */}
                  <span className="text-brand-bright">
                    {r.activates_at
                      .map((id) => PROFILS.find((p) => p.id === id))
                      .map((p) => (p ? `${p.id} ${t(p.label)}` : ""))
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </span>
            </li>
          ))}
          {/* Le filet qui ferme la dernière bascule appartient à la grille des
              rangées, pas à l'ouverture d'un bloc : il reste donc sur `--border`
              comme celles qui la précèdent, et non sur le filet cuivre. */}
          <li className="border-t border-[color:var(--border)]" />
        </ul>
      )}
    </div>
  );
}

export function Audience() {
  const { t } = useT();

  return (
    // Un bloc du relevé, et non plus une section à part. Les deux posaient la même
    // question — qui est concerné — avec le même sélecteur et le même état ; les
    // séparer faisait répondre deux fois. Ici l'aveu « voici où nous ne pouvons pas
    // bloquer » tombe juste après les revendications de couverture, ce qui est sa
    // place. `id` conservé : deux tests de navigateur le visent.
    <div id="pour-qui" className="mt-20 scroll-mt-20">
      <hr className="rule mb-10" />
      <h3 className="t-h2 max-w-3xl" data-sheen>
        {t("pourqui.title")}
      </h3>
      <p className="lead mt-4">{t("pourqui.lede")}</p>

      <Bascules />
    </div>
  );
}
