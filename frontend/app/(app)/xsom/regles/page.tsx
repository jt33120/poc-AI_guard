"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ConsoleError,
  ConsoleHeader,
  ConsoleSkeleton,
  EmptyState,
} from "@/components/ConsoleUI";
import { RulesWorkshop, WorkshopForbidden } from "@/components/rules/RulesWorkshop";
import { RULES_COPY, fill } from "@/components/rules/rules-copy";
import type {
  OperatorRulesView,
  OperatorTenant,
} from "@/components/rules/types";
import { apiGet } from "@/lib/client";
import { useT } from "@/lib/i18n";

import "../../../rules-pack.css";

/**
 * L'atelier des opérateurs xSOM. Le serveur décide qui y entre (`XSOM_OPERATOR_SUBJECTS`) :
 * un 403 ici n'est pas une erreur d'affichage, c'est la frontière entre la prestation
 * xSOM et l'administration du client.
 */
export default function XsomRulesPage() {
  const { lang } = useT();
  const copy = RULES_COPY[lang].operator;
  const [tenants, setTenants] = useState<OperatorTenant[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [selected, setSelected] = useState("");
  const [view, setView] = useState<OperatorRulesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const selectedRef = useRef("");
  const noticeRef = useRef<HTMLParagraphElement>(null);

  const loadTenants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTenants(await apiGet<OperatorTenant[]>("v1/xsom/tenants"));
    } catch (err) {
      if (String(err).includes("403")) setForbidden(true);
      else setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  const loadTenant = useCallback(async (tenantId: string) => {
    const run = ++generation.current;
    setView(null);
    setError(null);
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await apiGet<OperatorRulesView>(
        `v1/xsom/tenants/${tenantId}/rules-pack`,
      );
      if (run === generation.current) {
        setView(result);
        setRevision((value) => value + 1);
      }
    } catch (err) {
      if (run === generation.current) setError(err);
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    selectedRef.current = selected;
    void loadTenant(selected);
  }, [selected, loadTenant]);

  return (
    <section className="console-page rules-page">
      <ConsoleHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
      />
      {forbidden ? (
        <WorkshopForbidden />
      ) : (
        <>
          {error != null && (
            <ConsoleError
              error={error}
              retry={() =>
                void (selected ? loadTenant(selected) : loadTenants())
              }
            />
          )}
          {tenants && (
            <section className="console-panel">
              <div className="rules-body rules-fields">
                <div className="rules-field">
                  <label htmlFor="rules-tenant">{copy.tenant}</label>
                  <select
                    id="rules-tenant"
                    value={selected}
                    onChange={(event) => {
                      setNotice("");
                      setSelected(event.target.value);
                    }}
                  >
                    <option value="">{copy.chooseTenant}</option>
                    {tenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.name}
                        {tenant.version ? ` · v${tenant.version}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                {view && (
                  <p className="rules-tenant-state">
                    {copy.current}{" "}
                    <strong className="console-mono">
                      {view.pack
                        ? `v${view.pack.version} · ${view.pack.packId}`
                        : copy.none}
                    </strong>
                    {view.coverage && view.coverage.total > 0 && (
                      <span>
                        {" · "}
                        {fill(copy.coverage, {
                          up: view.coverage.up_to_date,
                          total: view.coverage.total,
                          behind: view.coverage.behind,
                          refused: view.coverage.refused,
                        })}
                      </span>
                    )}
                  </p>
                )}
              </div>
              {tenants.length === 0 && (
                <EmptyState title={copy.noTenants} description="" />
              )}
            </section>
          )}
          <p
            className="rules-status"
            role="status"
            data-tone={notice ? "allow" : undefined}
            tabIndex={-1}
            ref={noticeRef}
          >
            {notice}
          </p>
          {loading && <ConsoleSkeleton rows={3} />}
          {view && !loading && (
            <RulesWorkshop
              key={`${view.tenant.id}-${revision}`}
              view={view}
              onPublished={(tenantId, message) => {
                setNotice(message);
                noticeRef.current?.focus();
                // L'opérateur a pu changer de client pendant la signature : ne recharger
                // que celui qui est encore affiché.
                if (tenantId === selectedRef.current) void loadTenant(tenantId);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
