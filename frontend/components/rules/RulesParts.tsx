"use client";

import { localTime } from "@/components/ConsoleUI";
import { useT } from "@/lib/i18n";

import { RULES_COPY, fill } from "./rules-copy";
import type { Coverage, DetectorSummary, HistoryEntry } from "./types";

/** La répartition des postes : un compte lisible, puis chaque poste et son état. */
export function CoverageList({ coverage }: { coverage: Coverage | null }) {
  const { lang } = useT();
  const copy = RULES_COPY[lang];
  if (!coverage || coverage.total === 0) {
    return <p className="console-note">{copy.tenant.coverageNone}</p>;
  }
  return (
    <>
      <div className="rules-coverage" role="group" aria-label={copy.tenant.coverage}>
        <p className="rules-coverage-main">
          {fill(copy.tenant.coverageLine, {
            up: coverage.up_to_date,
            total: coverage.total,
          })}
        </p>
        <ul className="rules-coverage-counts">
          <li data-state="up_to_date">
            <strong>{coverage.up_to_date}</strong> {copy.tenant.upToDate}
          </li>
          <li data-state="behind">
            <strong>{coverage.behind}</strong> {copy.tenant.behind}
          </li>
          <li data-state="refused">
            <strong>{coverage.refused}</strong> {copy.tenant.refused}
          </li>
        </ul>
      </div>
      <ul className="risk-tool-list">
        {coverage.devices.map((device) => (
          <li key={device.id}>
            <div>
              <strong>{device.name}</strong>
              <span>
                {device.appliedVersion
                  ? fill(copy.tenant.applied, { v: device.appliedVersion })
                  : copy.tenant.notApplied}
                {device.expired ? ` · ${copy.tenant.expiredOnDevice}` : ""}
              </span>
            </div>
            <span className="rules-state" data-state={device.state}>
              {copy.states[device.state]}
            </span>
          </li>
        ))}
      </ul>
      <p className="console-note">{copy.tenant.coverageNote}</p>
    </>
  );
}

function matchDetail(detector: DetectorSummary, lang: "fr" | "en"): string[] {
  const copy = RULES_COPY[lang].tenant;
  const parts: string[] = [];
  if (detector.type === "terms") {
    parts.push(fill(copy.termsDetail, { n: detector.termsCount ?? 0 }));
  } else {
    if (detector.caseInsensitive) parts.push(copy.caseInsensitive);
    if (detector.minEntropyTenths != null)
      parts.push(fill(copy.entropy, { v: detector.minEntropyTenths / 10 }));
  }
  if (detector.context)
    parts.push(
      fill(copy.context, {
        k: detector.context.keywords.join(", "),
        w: detector.context.window,
      }),
    );
  return parts;
}

/** Les détecteurs en lecture seule. Un motif n'est montré qu'à l'administrateur. */
export function DetectorTable({ detectors }: { detectors: DetectorSummary[] }) {
  const { lang } = useT();
  const copy = RULES_COPY[lang];
  return (
    <div className="console-table-wrap">
      <table className="console-table rules-table">
        <thead>
          <tr>
            <th scope="col">{copy.tenant.colLabel}</th>
            <th scope="col">{copy.tenant.colCategory}</th>
            <th scope="col">{copy.tenant.colAction}</th>
            <th scope="col">{copy.tenant.colMatch}</th>
          </tr>
        </thead>
        <tbody>
          {detectors.map((detector) => (
            <tr key={detector.id}>
              <td data-label={copy.tenant.colLabel}>
                <strong>{detector.label}</strong>
                <small className="console-mono">{detector.id}</small>
              </td>
              <td data-label={copy.tenant.colCategory}>
                {copy.categories[detector.category]}
              </td>
              <td data-label={copy.tenant.colAction}>
                <span className="rules-action" data-action={detector.action}>
                  {copy.actions[detector.action]}
                </span>
              </td>
              <td data-label={copy.tenant.colMatch}>
                <span className="rules-type">{copy.types[detector.type]}</span>
                {detector.type === "pattern" &&
                  (detector.pattern ? (
                    <code className="rules-pattern">{detector.pattern}</code>
                  ) : (
                    <small>{copy.tenant.patternHidden}</small>
                  ))}
                {matchDetail(detector, lang).map((part) => (
                  <small key={part}>{part}</small>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HistoryList({ history }: { history: HistoryEntry[] }) {
  const { lang } = useT();
  const copy = RULES_COPY[lang].tenant;
  if (!history.length) return null;
  return (
    <ol className="rules-history">
      {history.map((entry) => (
        <li key={`${entry.event}-${entry.version}-${entry.at}`}>
          <strong>
            {fill(
              entry.event === "published"
                ? copy.historyPublished
                : copy.historyRevoked,
              { v: entry.version },
            )}
          </strong>
          <span>{localTime(entry.at, lang)}</span>
          <code className="console-mono">{entry.payloadDigest.slice(0, 12)}</code>
        </li>
      ))}
    </ol>
  );
}
