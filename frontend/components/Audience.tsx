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
function Plafond() {
  const { t } = useT();
  const { positionne } = useProfils();
  // **Toujours affiché**, et pas seulement quand le visiteur a coché le profil
  // concerné. La section s'intitule « et, tout aussi clairement, pour qui ce n'est
  // pas » : cacher la réponse derrière une case à cocher la réserverait à ceux qui
  // ont déjà deviné, et c'est l'affirmation la plus crédible de la page. Elle se
  // souligne quand elle devient le cas du lecteur, elle n'apparaît pas à ce
  // moment-là.
  const leur_cas = Boolean(positionne?.cap);
  return (
    // Le filet est **présent dans les deux états**, et c'est ce qui change.
    // `border-white/20` valait 1.86:1 : le lecteur ne voyait pas qu'il y avait un
    // filet, donc il n'avait rien à quoi comparer le filet cuivre. Sur
    // `--text-faint` (4.93:1) le rail est toujours là et c'est sa **teinte** qui
    // dit l'état, jamais sa présence.
    //
    // Les deux états ne peuvent pas se distinguer l'un de l'autre à 3:1 : sur
    // `--ink-900`, un filet à 3:1 du fond a une luminance de .124, et l'autre
    // devrait alors atteindre .471 — au-dessus de `--copper-sheen` (.463), la
    // teinte la plus claire de la charte. La contrainte est géométrique, pas un
    // choix. WCAG 1.4.11 demande d'ailleurs 3:1 contre les **couleurs
    // adjacentes**, donc contre le fond : les deux états y satisfont (4.93:1 et
    // 5.15:1), et l'état lui-même est en outre porté par du texte — la couleur du
    // libellé et le suffixe « · votre cas » ci-dessous — ce qui satisfait 1.4.1
    // sans dépendre de la teinte du filet.
    <div
      className={`mt-6 border-l-2 pl-4 ${
        leur_cas ? "border-[color:var(--copper-text)]" : "border-[color:var(--text-faint)]"
      }`}
    >
      <p className={`label ${leur_cas ? "text-brand-bright" : "text-[color:var(--text-low)]"}`}>
        {t("pourqui.plafond")}
        {leur_cas && (
          <span className="text-[color:var(--copper-text)]">
            {" · "}
            {t("pourqui.plafond.vous")}
          </span>
        )}
      </p>
      <p className="muted mt-1.5 max-w-2xl text-sm leading-relaxed">{t("pourqui.plafond.b")}</p>
    </div>
  );
}

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

        <div className="mt-10">
          <hr className="rule mb-8" />
          <h4 className="t-h3">{t("pourqui.tri.t")}</h4>
          <p className="muted mt-2 max-w-2xl text-sm leading-relaxed">{t("pourqui.tri.b")}</p>
          <Plafond />
        </div>

      <Bascules />
    </div>
  );
}
