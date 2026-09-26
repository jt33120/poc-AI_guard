"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ConsoleError,
  ConsoleHeader,
  ConsoleSkeleton,
  CopyButton,
  DataPair,
  EmptyState,
  localTime,
} from "@/components/ConsoleUI";
import {
  CoverageList,
  DetectorTable,
  HistoryList,
} from "@/components/rules/RulesParts";
import {
  RULES_COPY,
  adjustmentMailto,
  fill,
  shortDigest,
} from "@/components/rules/rules-copy";
import type { TenantRulesView } from "@/components/rules/types";
import { apiGet } from "@/lib/client";
import { useT } from "@/lib/i18n";

import "../../../rules-pack.css";

/**
 * Le réglage sur mesure vu par le client : lire, jamais écrire. Aucune case à cocher,
 * aucun champ : un ajustement se demande à xSOM, qui le compose et le signe.
 */
export default function RulesPackPage() {
  const { lang, t } = useT();
  const copy = RULES_COPY[lang].tenant;
  const [view, setView] = useState<TenantRulesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const run = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet<TenantRulesView>("v1/rules-pack");
      if (run === generation.current) setView(result);
    } catch (err) {
      if (run === generation.current) setError(err);
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const requests = generation;
    void refresh();
    return () => {
      requests.current++;
    };
  }, [refresh]);

  const pack = view?.pack ?? null;
  const mailto = adjustmentMailto(lang, pack?.version ?? null);

  return (
    <section className="console-page rules-page">
      <p>
        <Link className="rules-back" href="/extensions">
          {copy.back}
        </Link>
      </p>
      <ConsoleHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        actions={
          <>
            <a className="btn btn-primary" href={mailto}>
              {pack ? copy.ask : copy.askFirst}
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={loading}
              onClick={() => void refresh()}
            >
              {copy.refresh}
            </button>
          </>
        }
      />
      {view?.xsomOperator && (
        <p className="rules-operator-link">
          <Link href="/xsom/regles">{copy.operatorLink}</Link>
        </p>
      )}
      {error != null && (
        <ConsoleError error={error} retry={() => void refresh()} />
      )}
      {loading && !view ? (
        <ConsoleSkeleton rows={4} />
      ) : error == null && view && !pack ? (
        <section className="console-panel">
          <EmptyState
            title={copy.emptyTitle}
            description={copy.emptyBody}
            action={
              <a className="btn btn-ghost" href={mailto}>
                {copy.askFirst}
              </a>
            }
          />
        </section>
      ) : pack && view ? (
        <div className="rules-grid">
          <section className="console-panel" aria-labelledby="rules-status">
            <div className="console-panel-heading">
              <h2 id="rules-status">{copy.status}</h2>
              <span
                className="rules-badge"
                data-tone={
                  pack.revoked ? "deny" : pack.expired ? "hitl" : "allow"
                }
              >
                {pack.revoked
                  ? copy.revoked
                  : pack.expired
                    ? copy.expired
                    : copy.active}
              </span>
            </div>
            <dl className="rules-facts">
              <DataPair label={copy.version}>
                <span className="console-mono">
                  v{pack.version} · {pack.packId}
                </span>
              </DataPair>
              <DataPair label={copy.validity}>
                {localTime(pack.expiresAt, lang)}
              </DataPair>
              <DataPair label={copy.issuer}>{pack.issuer}</DataPair>
              <DataPair label={copy.published}>
                {localTime(pack.publishedAt, lang)}
              </DataPair>
              <DataPair label={copy.digest}>
                <code title={pack.payloadDigest}>
                  {shortDigest(pack.payloadDigest)}
                </code>{" "}
                <CopyButton text={pack.payloadDigest} label={t("common.copy")} />
              </DataPair>
              <DataPair label={copy.key}>
                <code title={pack.keyId}>{shortDigest(pack.keyId)}</code>
              </DataPair>
            </dl>
            <p
              className="console-note"
              role={view.chainIntact ? undefined : "alert"}
            >
              {view.chainIntact ? copy.chainOk : copy.chainBroken}{" "}
              {copy.signatureNote}
            </p>
          </section>
          <section className="console-panel" aria-labelledby="rules-coverage">
            <div className="console-panel-heading">
              <h2 id="rules-coverage">{copy.coverage}</h2>
              <span className="console-count">
                {view.coverage?.total ?? 0}
              </span>
            </div>
            <CoverageList coverage={view.coverage} />
          </section>
          <section
            className="console-panel rules-wide"
            aria-labelledby="rules-detectors"
          >
            <div className="console-panel-heading">
              <h2 id="rules-detectors">{copy.detectors}</h2>
              <span className="console-count">{pack.detectors.length}</span>
            </div>
            <DetectorTable detectors={pack.detectors} />
            <p className="console-note">
              {copy.detectorsNote}{" "}
              {fill(copy.tests, {
                p: pack.tests.positives,
                n: pack.tests.negatives,
              })}
            </p>
          </section>
          {view.history.length > 0 && (
            <section
              className="console-panel rules-wide"
              aria-labelledby="rules-history"
            >
              <div className="console-panel-heading">
                <h2 id="rules-history">{copy.history}</h2>
              </div>
              <HistoryList history={view.history} />
            </section>
          )}
        </div>
      ) : null}
    </section>
  );
}
