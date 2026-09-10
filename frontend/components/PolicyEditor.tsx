"use client";

import { useCallback, useEffect, useState } from "react";
import { useConsoleRole } from "@/components/AppShell";
import {
  ConsoleError,
  ConsoleSkeleton,
  EmptyState,
} from "@/components/ConsoleUI";
import { VerdictBadge } from "@/design-system/react";
import { apiGet, apiSend } from "@/lib/client";
import { type ToolView } from "@/lib/console-types";
import { useT } from "@/lib/i18n";

interface PolicyDoc {
  yaml: string;
  version: number;
}

export function PolicyEditor() {
  const { t, lang } = useT();
  const role = useConsoleRole();
  const [yaml, setYaml] = useState("");
  const [saved, setSaved] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [tools, setTools] = useState<ToolView[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [toolsError, setToolsError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [drafting, setDrafting] = useState(false);
  const canEdit = role === "admin";
  const tr = (fr: string, en: string) => (lang === "fr" ? fr : en);
  const loadTools = useCallback(async () => {
    try {
      setTools(await apiGet<ToolView[]>("v1/tools"));
      setToolsError(null);
    } catch (e) {
      setToolsError(e);
    }
  }, []);
  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const doc = await apiGet<PolicyDoc>("v1/policy");
      setYaml(doc.yaml);
      setSaved(doc.yaml);
      setVersion(doc.version);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadPolicy();
    void loadTools();
  }, [loadPolicy, loadTools]);
  async function save() {
    if (busy || !canEdit) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const doc = await apiSend<PolicyDoc>("v1/policy", "PUT", { yaml });
      setVersion(doc.version);
      setYaml(doc.yaml);
      setSaved(doc.yaml);
      setMessage(t("admin.policy.saved", { v: doc.version }));
      await loadTools();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function draftWithAI() {
    if (!prompt.trim() || !canEdit) return;
    setDrafting(true);
    setError(null);
    setMessage(null);
    try {
      const doc = await apiSend<PolicyDoc>("v1/policy/draft", "POST", {
        prompt: prompt.trim(),
      });
      setYaml(doc.yaml);
      setMessage(t("admin.ai.review"));
    } catch (e) {
      setError(e);
    } finally {
      setDrafting(false);
    }
  }
  return (
    <section className="console-panel policy-editor">
      <div className="console-panel-heading">
        <div>
          <p className="console-kicker">POLICY ENGINE</p>
          <h2>{t("admin.policy.title")}</h2>
        </div>
        <span className="console-count">version {version ?? "—"}</span>
      </div>
      {loading ? (
        <ConsoleSkeleton />
      ) : (
        <div className="policy-workspace">
          <div className="policy-source">
            <div className="policy-source-bar">
              <span>policy.yaml</span>
              <span data-dirty={yaml !== saved}>
                {yaml !== saved
                  ? tr("Modifications non publiées", "Unpublished changes")
                  : tr("Version enregistrée", "Saved version")}
              </span>
            </div>
            <textarea
              aria-label="Policy YAML"
              value={yaml}
              onChange={(e) => {
                setYaml(e.target.value);
                setMessage(null);
              }}
              rows={18}
              className="policy-yaml"
              spellCheck={false}
              readOnly={!canEdit || busy || drafting}
            />
            <div className="policy-save-row">
              <button
                type="button"
                onClick={save}
                disabled={busy || drafting || !canEdit || version === null}
                className="btn btn-primary"
              >
                {busy ? t("common.loading") : t("admin.policy.save")}
              </button>
              <span className="console-note">
                {tr(
                  "Le serveur valide le YAML avant publication.",
                  "The server validates YAML before publication.",
                )}
              </span>
            </div>
          </div>
          <aside className="policy-visual">
            <h3>{tr("Règles en service", "Rules in service")}</h3>
            <p className="console-note">
              {tr(
                "Lecture du registre effectif, actualisée après sauvegarde.",
                "Effective registry, refreshed after saving.",
              )}
            </p>
            {toolsError ? (
              <ConsoleError error={toolsError} retry={loadTools} />
            ) : tools.length ? (
              <ul>
                {tools.map((tool) => (
                  <li key={tool.canonical}>
                    <div>
                      <strong>{tool.name}</strong>
                      <span>
                        {tool.action_class ?? tr("Non classé", "Unclassified")}
                      </span>
                    </div>
                    <VerdictBadge value={tool.decision} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title={tr("Registre vide.", "Empty registry.")}
                description={tr(
                  "Les règles effectives apparaîtront quand des outils seront déclarés.",
                  "Effective rules will appear when tools are registered.",
                )}
              />
            )}
            <div className="policy-default">
              <span className="console-kicker">
                {tr("COMPORTEMENT PAR DÉFAUT", "DEFAULT BEHAVIOR")}
              </span>
              <p>
                {tr(
                  "Défini par la policy enregistrée. Consultez ses valeurs par défaut dans le YAML.",
                  "Defined by the saved policy. Check its defaults in the YAML.",
                )}
              </p>
            </div>
          </aside>
        </div>
      )}
      {message && (
        <p className="console-success" role="status">
          {message}
        </p>
      )}
      {error != null && (
        <ConsoleError
          error={error}
          retry={version === null ? loadPolicy : undefined}
        />
      )}
      {canEdit && (
        <details className="policy-assistant">
          <summary>{t("admin.ai.title")}</summary>
          <p className="console-note">{t("admin.ai.hint")}</p>
          <textarea
            aria-label={t("admin.ai.title")}
            value={prompt}
            readOnly={busy || drafting}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder={t("admin.ai.ph")}
            className="input"
          />
          <button
            type="button"
            onClick={draftWithAI}
            disabled={drafting || busy || !prompt.trim()}
            className="btn btn-ghost"
          >
            {drafting ? t("admin.ai.generating") : t("admin.ai.generate")}
          </button>
        </details>
      )}
    </section>
  );
}
