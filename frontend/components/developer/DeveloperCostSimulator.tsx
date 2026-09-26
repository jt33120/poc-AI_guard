"use client";

import { useMemo, useState } from "react";

import { useT } from "@/lib/i18n";

type Values = { seats: number; current: number; provider: number; guard: number; operations: number; support: number; deployment: number; months: number };

export function DeveloperCostSimulator() {
  const { lang } = useT();
  const [values, setValues] = useState<Values>({ seats: 20, current: 300, provider: 90, guard: 24, operations: 500, support: 250, deployment: 4000, months: 12 });
  const labels = lang === "fr" ? {
    seats: "Développeurs", current: "Coût actuel / siège / mois", provider: "Abonnement assistant / siège / mois", guard: "Hypothèse xSOM / siège / mois", operations: "Exploitation interne / mois", support: "Support / mois", deployment: "Déploiement initial", months: "Mois d’amortissement", currentTotal: "Total actuel", proposed: "Scénario encadré", difference: "Écart mensuel", saving: "économie", over: "surcoût", currency: "€ / mois", note: "Résultat indicatif hors taxes, quotas, engagements, indisponibilités et coûts de changement. Les valeurs initiales sont des exemples modifiables, pas des tarifs vérifiés." } : {
    seats: "Developers", current: "Current cost / seat / month", provider: "Assistant subscription / seat / month", guard: "xSOM assumption / seat / month", operations: "Internal operations / month", support: "Support / month", deployment: "Initial deployment", months: "Amortisation months", currentTotal: "Current total", proposed: "Governed scenario", difference: "Monthly difference", saving: "saving", over: "extra cost", currency: "€ / month", note: "Indicative result excluding tax, quotas, commitments, downtime and switching costs. Initial values are editable examples, not verified prices." };
  const totals = useMemo(() => {
    const currentTotal = values.seats * values.current;
    const proposed = values.seats * (values.provider + values.guard) + values.operations + values.support + values.deployment / Math.max(1, values.months);
    return { currentTotal, proposed, difference: currentTotal - proposed };
  }, [values]);
  const update = (key: keyof Values, raw: string) => setValues((current) => ({ ...current, [key]: Math.max(0, Number(raw) || 0) }));
  const format = (value: number) => new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 0 }).format(value);

  return (
    <div className="developer-cost" data-testid="developer-cost">
      <div className="developer-cost__fields">
        {(Object.keys(values) as (keyof Values)[]).map((key) => (
          <label key={key}><span>{labels[key]}</span><input type="number" min="0" step="1" value={values[key]} onChange={(event) => update(key, event.target.value)} /></label>
        ))}
      </div>
      <div className="developer-cost__results" aria-live="polite">
        <div><span>{labels.currentTotal}</span><strong>{format(totals.currentTotal)} {labels.currency}</strong></div>
        <div><span>{labels.proposed}</span><strong>{format(totals.proposed)} {labels.currency}</strong></div>
        <div className="developer-cost__difference" data-negative={totals.difference < 0}><span>{labels.difference} · {totals.difference >= 0 ? labels.saving : labels.over}</span><strong>{totals.difference >= 0 ? "+" : "−"}{format(Math.abs(totals.difference))} {labels.currency}</strong></div>
      </div>
      <p>{labels.note}</p>
    </div>
  );
}
