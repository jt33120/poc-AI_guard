"use client";

/**
 * L'explorateur d'audit du tenant de démonstration (`L8`).
 *
 * Le second des deux écrans que la fixture alimente honnêtement. La synthèse dirigeant
 * répond au dirigeant ; celui-ci répond au RSSI, qui ne veut pas des agrégats mais la
 * suite des décisions, dans l'ordre, avec la règle qui a tranché.
 *
 * Même forme que le relevé des menaces : des rangées séparées d'un filet, tout en mono,
 * pas de cartes. Un journal se lit comme un journal.
 *
 * Ce que la page ne montre pas, et le dit : **le contenu des arguments**. Le produit
 * n'en journalise jamais (`CLAUDE.md` §4.10), donc l'instantané n'en porte pas — ce
 * n'est pas une omission de démonstration, c'est la propriété démontrée.
 */

import { useState } from "react";

import { INSTANTANE, type EntreeInstantane } from "@/lib/demo";
import { useT } from "@/lib/i18n";

//: Combien de lignes on montre d'emblée. Le reste est compté, jamais caché en silence :
//: une liste tronquée sans mention se lit comme une liste complète.
const APERCU = 12;

/** Les décisions qui disent « l'action n'a pas eu lieu ». */
const REFUS = new Set(["deny", "hitl_denied", "expired"]);
/** Celles qui disent « un humain a été sollicité, ou l'action a été retenue ». */
const RETENUE = new Set(["hitl_pending", "hitl_approved", "monitor_hold"]);

function tonDecision(decision: string | null): string {
  if (decision && REFUS.has(decision)) return "text-brand-bright";
  if (decision && RETENUE.has(decision)) return "text-amber-300";
  return "text-white/45";
}

function Ligne({ entree }: { entree: EntreeInstantane }) {
  const { t } = useT();
  return (
    <li className="grid grid-cols-[3.5rem_1fr_auto] items-baseline gap-x-4 border-t border-white/10 py-2.5 font-mono text-[11px] sm:gap-x-6">
      <span className="text-white/30">
        {entree.jours}
        {t("demo.journal.jours")}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-white/70">{entree.outil}</span>
        <span className="block truncate text-white/30">
          {entree.classe}
          {entree.regle && entree.regle !== entree.outil && ` · ${entree.regle}`}
          {entree.raison && ` · ${entree.raison}`}
        </span>
      </span>
      <span className={`whitespace-nowrap ${tonDecision(entree.decision)}`}>
        {entree.decision}
      </span>
    </li>
  );
}

export function JournalDemo() {
  const { t } = useT();
  const [tout, setTout] = useState(false);
  // Les plus récentes d'abord : un journal se lit par la fin.
  const journal = [...INSTANTANE.journal].reverse();
  const montrees = tout ? journal : journal.slice(0, APERCU);
  const reste = journal.length - montrees.length;

  return (
    <div className="card p-6 sm:p-8">
      <h3 className="font-display text-lg font-bold sm:text-xl">{t("demo.journal.t")}</h3>
      <p className="muted mt-2 max-w-2xl text-sm leading-relaxed">{t("demo.journal.b")}</p>

      <ul className="mt-5">
        {montrees.map((entree, i) => (
          <Ligne key={`${entree.jours}-${entree.outil}-${i}`} entree={entree} />
        ))}
        <li className="border-t border-white/10" />
      </ul>

      {reste > 0 && (
        <button
          type="button"
          onClick={() => setTout(true)}
          className="muted mt-4 font-mono text-[11px] underline underline-offset-4 hover:text-white"
        >
          {t("demo.journal.reste", { n: reste })}
        </button>
      )}

      <div className="mt-8 border-t border-white/10 pt-6">
        <p className="font-mono text-[11px] uppercase tracking-wider text-white/50">
          {t("demo.portee")}
        </p>
        {/* Dire ce qui manque, et pourquoi, plutôt que de le combler avec une file
            d'approbation fabriquée. Une demande en attente dans un instantané daté se
            lit comme une demande à laquelle personne n'a répondu. */}
        <p className="muted mt-1.5 max-w-2xl text-sm leading-relaxed">{t("demo.portee.b")}</p>
      </div>
    </div>
  );
}
