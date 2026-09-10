"use client";

import { formatUsd } from "@/components/ClientScope";
import { ShieldMark } from "@/components/brand";
import { type StrKey, useT } from "@/lib/i18n";
import type { DecisionCounts } from "@/lib/executive-counts";

export type ExecCounts = DecisionCounts;

const MEANS: { t: StrKey; b: StrKey }[] = [
  { t: "exec.means.1.t", b: "exec.means.1.b" },
  { t: "exec.means.2.t", b: "exec.means.2.b" },
  { t: "exec.means.3.t", b: "exec.means.3.b" },
];

// Presentation-only body of the executive summary. Both the authenticated
// /executive page (live data) and the public /executive-preview (sample data)
// render this so the two never drift apart.
export function ExecutiveSummary({
  governed,
  counts,
  spendUsd,
  entrees,
  operational = false,
  otherEvents = 0,
}: {
  governed: number;
  counts: ExecCounts;
  spendUsd?: number;
  /**
   * Le nombre d'entrées réellement journalisées, quand on le connaît.
   *
   * Il remplace le « 100 % » de la quatrième KPI sur la surface publique. Ce
   * « 100 % » était **écrit en dur**, et le commentaire qui l'accompagnait le disait
   * sans le vouloir : une « réassurance », pas une mesure. Il n'est d'ailleurs pas
   * démontrable — un taux de couverture demande un dénominateur, et une action non
   * journalisée ne laisse par définition aucune trace pour le fournir.
   *
   * Ce qui **est** démontrable, c'est le nombre d'entrées écrites et le fait que leur
   * chaîne se vérifie. C'est moins flatteur et c'est vrai, ce qui est exactement le
   * parti pris de cette page.
   */
  entrees?: number;
  operational?: boolean;
  otherEvents?: number;
}) {
  const { t, lang } = useT();
  const tr = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const total = counts.allow + counts.review + counts.block;
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : "0%");

  // Quand la dépense réelle est disponible (vue authentifiée), elle occupe la
  // quatrième KPI : elle parle au dirigeant comme au constructeur.
  //
  // Sinon on montre **le nombre d'entrées journalisées**, quand on le connaît, plutôt
  // qu'un « 100 % » écrit en dur. Faute des deux, la KPI n'est pas affichée : une
  // case vide vaut mieux qu'un chiffre que rien n'appuie.
  const lastKpi =
    spendUsd !== undefined
      ? {
          value: formatUsd(spendUsd),
          label: "exec.kpi.cost.l" as StrKey,
          sub: "exec.kpi.cost.s" as StrKey,
          tone: "text-emerald-300",
        }
      : entrees !== undefined
        ? {
            value: entrees,
            label: "exec.kpi.entrees.l" as StrKey,
            sub: "exec.kpi.entrees.s" as StrKey,
            tone: "text-emerald-300",
          }
        : null;

  const KPIS: {
    value: string | number;
    label: StrKey;
    sub: StrKey;
    tone: string;
  }[] = [
    {
      value: governed,
      label: "exec.kpi.governed.l",
      sub: "exec.kpi.governed.s",
      tone: "text-brand-bright",
    },
    {
      value: counts.review,
      label: "exec.kpi.review.l",
      sub: "exec.kpi.review.s",
      tone: "text-amber-300",
    },
    {
      value: counts.block,
      label: "exec.kpi.blocked.l",
      sub: "exec.kpi.blocked.s",
      tone: "text-red-300",
    },
    ...(lastKpi ? [lastKpi] : []),
  ];

  return (
    <>
      {/* Headline KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {KPIS.map((k) => (
          <div key={k.label} className="card p-6">
            <div className={`text-4xl font-extrabold tracking-tight ${k.tone}`}>
              {k.value}
            </div>
            <div className="mt-2 font-semibold">
              {operational && k.label === "exec.kpi.governed.l"
                ? tr("Outils déclarés", "Registered tools")
                : operational && k.label === "exec.kpi.review.l"
                  ? tr("Événements HITL", "HITL events")
                  : operational && k.label === "exec.kpi.blocked.l"
                    ? tr("Refus enregistrés", "Recorded denials")
                    : t(k.label)}
            </div>
            <div className="muted mt-1 text-sm leading-snug">
              {operational && k.label === "exec.kpi.governed.l"
                ? tr("Registre du tenant.", "Tenant registry.")
                : operational &&
                    (k.label === "exec.kpi.review.l" ||
                      k.label === "exec.kpi.blocked.l")
                  ? tr(
                      "Dans les événements chargés.",
                      "Within the loaded events.",
                    )
                  : t(k.sub)}
            </div>
          </div>
        ))}
      </div>

      {/* What happened to the actions */}
      <div className="card p-6">
        <h2 className="font-semibold">
          {operational
            ? tr(
                "Décisions dans les événements chargés",
                "Decisions within loaded events",
              )
            : t("exec.chart.title")}
        </h2>
        {total === 0 ? (
          <p className="muted mt-3 text-sm">
            {operational
              ? tr(
                  "Aucune décision d’autorisation, de revue ou de refus dans les événements chargés.",
                  "No allow, review or deny decision in the loaded events.",
                )
              : t("exec.chart.empty")}
          </p>
        ) : (
          <>
            <div className="mt-4 flex h-4 w-full overflow-hidden rounded-pill bg-white/5">
              <div
                className="console-distribution-allow"
                style={{ width: pct(counts.allow) }}
              />
              <div
                className="console-distribution-hitl"
                style={{ width: pct(counts.review) }}
              />
              <div
                className="console-distribution-deny"
                style={{ width: pct(counts.block) }}
              />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full console-distribution-allow" />
                <span className="muted">
                  {operational
                    ? tr("Autorisations", "Allow decisions")
                    : t("exec.chart.allow")}
                </span>
                <span className="ml-auto font-semibold text-white">
                  {counts.allow}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full console-distribution-hitl" />
                <span className="muted">
                  {operational
                    ? tr("Décisions HITL", "HITL decisions")
                    : t("exec.chart.review")}
                </span>
                <span className="ml-auto font-semibold text-white">
                  {counts.review}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full console-distribution-deny" />
                <span className="muted">
                  {operational ? tr("Refus", "Denials") : t("exec.chart.block")}
                </span>
                <span className="ml-auto font-semibold text-white">
                  {counts.block}
                </span>
              </div>
            </div>
          </>
        )}
        {operational && (
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="muted">
                {tr("Autres événements", "Other events")}
              </span>
              <span className="ml-auto font-semibold">{otherEvents}</span>
            </div>
            <p className="muted mt-2 text-sm leading-relaxed">
              {tr(
                "Événements de garde, observations, trafic non inspecté ou verdict inconnu. Exclus de la répartition des décisions, jamais assimilés à une autorisation.",
                "Guard events, observations, uninspected traffic or unknown verdicts. Excluded from the decision distribution, never counted as an authorization.",
              )}
            </p>
          </div>
        )}
      </div>

      {/* What this means for you */}
      {!operational && (
        <>
          <div>
            <h2 className="text-xl font-bold">{t("exec.means.title")}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {MEANS.map((m, i) => (
                <div key={m.t} className="card p-5">
                  <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-brand/15 text-sm font-bold text-brand-bright ring-1 ring-brand/30">
                    {i + 1}
                  </div>
                  <h3 className="font-semibold">{t(m.t)}</h3>
                  <p className="muted mt-1.5 text-sm leading-relaxed">
                    {t(m.b)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Compliance band */}
          <div className="flex items-start gap-4 rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/15 to-transparent p-6">
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/20 text-brand-bright ring-1 ring-brand/40">
              <ShieldMark className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">{t("exec.comp.title")}</h2>
              <p className="muted mt-1.5 max-w-2xl text-sm leading-relaxed">
                {t("exec.comp.body")}
              </p>
            </div>
          </div>

          {/* Bottom line */}
          <p className="text-center text-lg font-semibold text-white/90">
            {t("exec.bottom")}
          </p>
        </>
      )}
    </>
  );
}
