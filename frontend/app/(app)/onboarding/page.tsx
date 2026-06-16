"use client";

import Link from "next/link";
import { useState } from "react";

import { apiSend } from "@/lib/client";
import { type StrKey, useT } from "@/lib/i18n";

const XSOM_API = "https://xsom-ai-guard-production.up.railway.app";

type Tpl = "monitor" | "balanced" | "strict";
type Stack = "http" | "langchain" | "mcp" | "openai" | "anthropic";

const STACKS: { id: Stack; label: string }[] = [
  { id: "http", label: "Custom (HTTP API)" },
  { id: "langchain", label: "LangChain / LangGraph" },
  { id: "mcp", label: "MCP tools" },
  { id: "openai", label: "OpenAI (direct)" },
  { id: "anthropic", label: "Anthropic (direct)" },
];

const TEMPLATES: { id: Tpl; t: StrKey; d: StrKey }[] = [
  { id: "monitor", t: "onb.tpl.monitor.t", d: "onb.tpl.monitor.d" },
  { id: "balanced", t: "onb.tpl.balanced.t", d: "onb.tpl.balanced.d" },
  { id: "strict", t: "onb.tpl.strict.t", d: "onb.tpl.strict.d" },
];

const CLASS_APPROVALS: Record<Tpl, Record<string, string>> = {
  monitor: { read: "auto", write: "auto", external_send: "auto", irreversible: "auto", unknown: "auto" },
  balanced: { read: "auto", write: "auto", external_send: "human_in_the_loop", irreversible: "human_in_the_loop", unknown: "deny" },
  strict: { read: "auto", write: "human_in_the_loop", external_send: "human_dual", irreversible: "human_dual", unknown: "deny" },
};

function policyYaml(tpl: Tpl, agent: string): string {
  const c = CLASS_APPROVALS[tpl];
  return `# xSOM policy — ${tpl} protection${agent ? ` for ${agent}` : ""}
# Tools are auto-classified by name; add explicit rules under "tools:" to override.
tools: []
defaults:
  unknown_tool: ${c.unknown}
  auto_classify: true
  class_approvals:
    read: ${c.read}
    write: ${c.write}
    external_send: ${c.external_send}
    irreversible: ${c.irreversible}
`;
}

function snippet(stack: Stack, key: string): string {
  if (stack === "mcp") {
    return `# Point your agent's MCP client at the xSOM gateway and pass this token.
# xSOM proxies your downstream MCP tool servers and gates every tool call.
export XSOM_GATEWAY_TOKEN="${key}"
# (configure the xSOM MCP server as your agent's tools endpoint)`;
  }
  if (stack === "openai") {
    return `# Zero-code monitoring — just point the OpenAI SDK at xSOM.
# Your OPENAI_API_KEY is still used and forwarded to OpenAI.
from openai import OpenAI

client = OpenAI(
    base_url="${XSOM_API}/proxy/openai/v1",
    default_headers={"X-Gateway-Token": "${key}"},
    # add "X-XSOM-Mode": "enforce" to also block non-allowed tool-calls
)
# Use the client exactly as before — xSOM audits every tool-call it makes.`;
  }
  if (stack === "anthropic") {
    return `# Zero-code monitoring — point the Anthropic SDK at xSOM.
# Your ANTHROPIC_API_KEY is still used and forwarded to Anthropic.
from anthropic import Anthropic

client = Anthropic(
    base_url="${XSOM_API}/proxy/anthropic",
    default_headers={"X-Gateway-Token": "${key}"},
    # add "X-XSOM-Mode": "enforce" to also block non-allowed tool-calls
)
# Use the client exactly as before — xSOM audits every tool_use it makes.`;
  }
  return `import requests

XSOM_API = "${XSOM_API}"
XSOM_KEY = "${key}"

def allowed(tool: str, arguments: dict) -> bool:
    r = requests.post(
        f"{XSOM_API}/v1/authorize",
        headers={"X-Gateway-Token": XSOM_KEY},
        json={"tool": tool, "arguments": arguments},
        timeout=30,
    )
    # "allow" -> run it | "hold" -> wait for human approval | "deny" -> blocked
    return r.json().get("decision") == "allow"

# Before your agent executes any tool:
if allowed("crm.delete_contact", {"id": 42}):
    crm.delete_contact(id=42)`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost px-3 py-1 text-xs"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? t("onb.copied") : label}
    </button>
  );
}

export default function OnboardingPage() {
  const { t } = useT();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [stack, setStack] = useState<Stack>("http");
  const [tpl, setTpl] = useState<Tpl>("balanced");
  const [mode, setMode] = useState<"template" | "ai">("template");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiYaml, setAiYaml] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  const effectiveYaml = mode === "ai" && aiYaml ? aiYaml : policyYaml(tpl, name.trim());

  async function draftAI() {
    if (!aiPrompt.trim()) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const doc = await apiSend<{ yaml: string }>("v1/policy/draft", "POST", {
        prompt: aiPrompt.trim(),
      });
      setAiYaml(doc.yaml);
    } catch (e: unknown) {
      setAiError(String(e).includes("503") ? t("admin.ai.unavailable") : t("admin.ai.error"));
    } finally {
      setAiBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await apiSend("v1/policy", "PUT", { yaml: effectiveYaml });
      const tok = await apiSend<{ token: string }>("v1/gateway-tokens", "POST", {
        name: name.trim() || "agent",
      });
      setApiKey(tok.token);
      setStep(4);
    } catch (e: unknown) {
      setError(`${t("onb.error")}: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const steps: StrKey[] = ["onb.s1", "onb.s2", "onb.s3"];

  return (
    <section className="mx-auto flex max-w-2xl animate-fade-up flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">{t("onb.title")}</h1>
        <p className="muted mt-1.5">{t("onb.subtitle")}</p>
      </header>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => {
          const n = i + 1;
          const active = step >= n;
          return (
            <div key={s} className="flex items-center gap-2">
              <span
                className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${
                  active ? "bg-brand text-white" : "bg-white/10 text-white/50"
                }`}
              >
                {n}
              </span>
              <span className={`text-sm ${active ? "text-white" : "text-white/50"}`}>{t(s)}</span>
              {i < steps.length - 1 ? <span className="mx-1 h-px w-6 bg-white/15" /> : null}
            </div>
          );
        })}
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      {/* Step 1 — agent + stack */}
      {step === 1 ? (
        <div className="card flex flex-col gap-5 p-6">
          <div>
            <label className="label">{t("onb.name.label")}</label>
            <input
              className="input mt-1.5"
              placeholder={t("onb.name.ph")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t("onb.stack.label")}</label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {STACKS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStack(s.id)}
                  className={`rounded-xl border px-3.5 py-2.5 text-left text-sm transition ${
                    stack === s.id
                      ? "border-brand bg-brand/10 text-white"
                      : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>
              {t("onb.next")}
            </button>
          </div>
        </div>
      ) : null}

      {/* Step 2 — protection: template or AI prompt */}
      {step === 2 ? (
        <div className="card flex flex-col gap-5 p-6">
          {/* mode toggle */}
          <div className="flex w-fit rounded-pill border border-white/15 bg-white/[0.04] p-0.5 text-sm font-semibold">
            {(["template", "ai"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-pill px-3.5 py-1 transition ${
                  mode === m ? "bg-brand text-white" : "text-white/55 hover:text-white"
                }`}
              >
                {t(m === "template" ? "onb.tpl.mode.template" : "onb.tpl.mode.ai")}
              </button>
            ))}
          </div>

          {mode === "template" ? (
            <>
              <label className="label">{t("onb.tpl.label")}</label>
              <div className="flex flex-col gap-2">
                {TEMPLATES.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTpl(opt.id)}
                    className={`rounded-xl border p-4 text-left transition ${
                      tpl === opt.id
                        ? "border-brand bg-brand/10"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{t(opt.t)}</span>
                      {opt.id === "balanced" ? (
                        <span className="badge badge-blue">{t("onb.recommended")}</span>
                      ) : null}
                    </div>
                    <p className="muted mt-1 text-sm">{t(opt.d)}</p>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <textarea
                aria-label={t("onb.tpl.mode.ai")}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={3}
                placeholder={t("admin.ai.ph")}
                className="input resize-y text-sm"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={draftAI}
                  disabled={aiBusy || !aiPrompt.trim()}
                  className="btn btn-primary px-4 py-1.5"
                >
                  {aiBusy ? t("admin.ai.generating") : t("admin.ai.generate")}
                </button>
                <p className="muted text-xs">{t("admin.ai.hint")}</p>
              </div>
              {aiError ? <p className="text-sm text-red-300">{aiError}</p> : null}
              {aiYaml ? (
                <>
                  <p className="text-sm text-emerald-300">{t("onb.ai.ready")}</p>
                  <pre className="overflow-x-auto rounded-xl bg-navy-mid/70 p-4 text-xs text-white/80">
                    {aiYaml}
                  </pre>
                </>
              ) : null}
            </div>
          )}

          <div className="flex justify-between">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
              {t("onb.back")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep(3)}
              disabled={mode === "ai" && !aiYaml}
            >
              {t("onb.next")}
            </button>
          </div>
        </div>
      ) : null}

      {/* Step 3 — confirm + generate */}
      {step === 3 ? (
        <div className="card flex flex-col gap-4 p-6">
          <div>
            <span className="label">{t("onb.s2")}</span>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-navy-mid/70 p-4 text-xs text-white/80">
              {effectiveYaml}
            </pre>
          </div>
          <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
            {t("onb.warn")}
          </p>
          <div className="flex justify-between">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>
              {t("onb.back")}
            </button>
            <button type="button" className="btn btn-primary" onClick={finish} disabled={busy}>
              {busy ? t("onb.generating") : t("onb.generate")}
            </button>
          </div>
        </div>
      ) : null}

      {/* Step 4 — done: key + snippet */}
      {step === 4 && apiKey ? (
        <div className="flex flex-col gap-4">
          <div className="card p-6">
            <h2 className="font-semibold">{t("onb.done.t")}</h2>
            <p className="muted mt-1 text-sm">{t("onb.done.d")}</p>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("onb.key.title")}</h3>
              <CopyButton text={apiKey} label={t("onb.copy")} />
            </div>
            <code className="mt-2 block break-all rounded-lg bg-navy-mid/70 px-3 py-2 font-mono text-xs text-brand-bright">
              {apiKey}
            </code>
            <p className="muted mt-2 text-xs">{t("onb.key.note")}</p>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("onb.snippet.title")}</h3>
              <CopyButton text={snippet(stack, apiKey)} label={t("onb.copy")} />
            </div>
            <p className="muted mt-1 text-xs">
              {t(stack === "openai" || stack === "anthropic" ? "onb.snippet.proxy" : "onb.snippet.note")}
            </p>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-navy-mid/70 p-4 text-xs text-white/80">
              {snippet(stack, apiKey)}
            </pre>
          </div>

          <div className="flex gap-3">
            <Link href="/inspector" className="btn btn-primary">
              {t("nav.inspector")}
            </Link>
            <Link href="/home" className="btn btn-ghost">
              {t("nav.home")}
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}
