"use client";

/**
 * Le rejeu, à l'écran : deux colonnes, le même appel, une seule différence (`L6`).
 *
 * Ce n'est pas une vidéo, et c'est mieux qu'une vidéo. Les deux colonnes sont des
 * traces d'audit **capturées pendant l'exécution de la suite de tests** : à gauche le
 * contrôle négatif, garde retiré, où l'action arrive ; à droite le scénario bloquant,
 * garde en place, où elle est refusée. Les outils appelés sont identiques — le
 * générateur refuse d'apparier deux exécutions qui n'exercent pas les mêmes.
 *
 * Filmer un blocage seul montrerait un écran où rien ne se passe, ce qu'un plantage ou
 * un nom d'outil mal orthographié produiraient à l'identique. La colonne de gauche est
 * ce qui rend la droite lisible.
 */

import { Fragment } from "react";

import { useT } from "@/lib/i18n";
import { raisonSansRejeu, type EntreeAudit, type Execution, type Rejeu } from "@/lib/replays";

/** Une empreinte, montrée courte : elle prouve qu'on hache, pas qu'on stocke. */
function Empreinte({ hash }: { hash: string | null }) {
  const { t } = useT();
  if (!hash) return <span className="text-[color:var(--text-faint)]">{t("rejeu.empreinte.aucune")}</span>;
  return <span className="text-[color:var(--text-low)]">{hash.slice(0, 12)}…</span>;
}

function Entree({
  entree,
  rang,
  apresDivergence,
}: {
  entree: EntreeAudit;
  rang: number;
  apresDivergence: boolean;
}) {
  return (
    <li
      className={`grid grid-cols-[1.5rem_1fr] gap-x-3 border-t border-white/[0.07] py-2.5 font-mono text-[11px] leading-relaxed ${
        apresDivergence ? "text-white" : "text-[color:var(--text-mid)]"
      }`}
    >
      <span className={apresDivergence ? "text-brand" : "text-[color:var(--text-faint)]"}>{rang}</span>
      <span className="min-w-0">
        <span className="block truncate">
          {/* La décision brute, telle que le journal la porte. La traduire donnerait
              une table de correspondance à tenir à jour, et un refus finirait un jour
              affiché comme une autorisation. */}
          <span className={apresDivergence ? "font-semibold text-brand-bright" : ""}>
            {entree.decision}
          </span>
          {entree.tool_name && <span className="text-[color:var(--text-low)]"> · {entree.tool_name}</span>}
        </span>
        {(entree.action_class || entree.error) && (
          <span className="block truncate text-[color:var(--text-low)]">
            {entree.action_class}
            {entree.action_class && entree.error && " · "}
            {entree.error}
          </span>
        )}
        <span className="block truncate">
          <Empreinte hash={entree.args_hash} />
        </span>
      </span>
    </li>
  );
}

function Colonne({
  titre,
  sous,
  execution,
  divergence,
  accent,
}: {
  titre: string;
  sous: string;
  execution: Execution;
  divergence: number | null;
  accent: boolean;
}) {
  const { t } = useT();
  return (
    <div
      className={`min-w-0 border-t-2 pt-3 ${accent ? "border-brand" : "border-[color:var(--text-faint)]"}`}
    >
      <h5
        className={`font-mono text-[11px] uppercase tracking-wider ${
          accent ? "text-brand-bright" : "text-[color:var(--text-low)]"
        }`}
      >
        {titre}
      </h5>
      <p className="muted mt-0.5 text-xs">{sous}</p>

      {/* Un `Fragment`, pas un `<li>` enveloppant : une liste ne peut pas contenir un
          élément de liste dans un autre, et le marqueur de divergence est un frère des
          entrées, pas leur enfant. */}
      <ol className="mt-3">
        {execution.entrees.map((entree, i) => (
          <Fragment key={`${entree.decision}-${i}`}>
            {divergence !== null && i === divergence && (
              <li aria-hidden="true" className="mt-1 border-t-2 border-brand pt-1" />
            )}
            <Entree
              entree={entree}
              rang={i + 1}
              apresDivergence={divergence !== null && i >= divergence}
            />
          </Fragment>
        ))}
      </ol>

      <p className="muted mt-3 font-mono text-[10px]">
        {execution.chainee ? `✓ ${t("rejeu.chainee")}` : `✗ ${t("rejeu.chainee.non")}`}
      </p>
      <p className="muted mt-1 break-all font-mono text-[10px] text-[color:var(--text-faint)]">{execution.test}</p>
    </div>
  );
}

export function ReplayPanel({ rowId, rejeu }: { rowId: string; rejeu: Rejeu | undefined }) {
  const { t } = useT();
  if (!rejeu) {
    // Pas de cadre vide : une ligne sans rejeu publie **sa raison**, comme une facette
    // non couverte publie la sienne (`FR-144`). Dire pourquoi il n'y a rien à montrer
    // est plus fort que ne rien montrer.
    const raison = raisonSansRejeu(rowId);
    return <p className="muted text-sm leading-relaxed">{raison ?? t("rejeu.absent")}</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-display text-sm font-bold text-brand-bright">{t("rejeu.titre")}</h4>
        <p className="muted mt-1 text-sm leading-relaxed">{t("rejeu.lede")}</p>
      </div>

      <p className="muted font-mono text-[11px]">
        {t("rejeu.outils")} : {rejeu.outils.join(" → ")}
      </p>

      {rejeu.divergence !== null && (
        <p className="border-l-2 border-brand pl-3 font-mono text-[11px] uppercase tracking-wider text-brand">
          {t("rejeu.divergence")}
        </p>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <Colonne
          titre={t("rejeu.sans")}
          sous={t("rejeu.sans.b")}
          execution={rejeu.sans_garde}
          divergence={rejeu.divergence}
          accent={false}
        />
        <Colonne
          titre={t("rejeu.avec")}
          sous={t("rejeu.avec.b")}
          execution={rejeu.avec_garde}
          divergence={rejeu.divergence}
          accent
        />
      </div>

      <p className="muted text-xs leading-relaxed">
        {t("rejeu.source")} {t("rejeu.empreinte.note")}
      </p>
    </div>
  );
}
