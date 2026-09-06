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
    <div className={`mt-6 border-l-2 pl-4 ${leur_cas ? "border-brand" : "border-white/20"}`}>
      <p
        className={`font-mono text-[11px] uppercase tracking-wider ${
          leur_cas ? "text-brand-bright" : "text-white/50"
        }`}
      >
        {t("pourqui.plafond")}
        {leur_cas && <span className="text-brand"> · {t("pourqui.plafond.vous")}</span>}
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
    <div className="mt-10 border-t border-white/10 pt-8">
      <h3 className="font-display text-lg font-bold sm:text-xl">{t("pourqui.bascules.t")}</h3>
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
              className="grid grid-cols-[3.5rem_1fr] gap-x-4 border-t border-white/10 py-3 sm:grid-cols-[4rem_1fr] sm:gap-x-6"
            >
              <span className="font-mono text-xs text-brand">{r.id}</span>
              <span className="min-w-0">
                <span className="block font-display text-base font-semibold text-white">
                  {r.titre}
                </span>
                <span className="muted mt-1 block font-mono text-[11px]">
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
          <li className="border-t border-white/10" />
        </ul>
      )}
    </div>
  );
}

export function Audience() {
  const { t } = useT();

  return (
    <section id="pour-qui" className="mx-auto max-w-5xl scroll-mt-20 px-6 py-16">
      <span className="label text-brand-bright">{t("pourqui.kicker")}</span>
      <h2 className="mt-2 max-w-3xl font-display text-2xl font-bold sm:text-4xl">
        {t("pourqui.title")}
      </h2>
      <p className="muted mt-4 max-w-2xl text-base leading-relaxed">{t("pourqui.lede")}</p>

      <div className="mt-10 border-t border-white/10 pt-8">
        <h3 className="font-display text-lg font-bold sm:text-xl">{t("pourqui.tri.t")}</h3>
        <p className="muted mt-2 max-w-2xl text-sm leading-relaxed">{t("pourqui.tri.b")}</p>
        <Plafond />
      </div>

      <Bascules />
    </section>
  );
}
