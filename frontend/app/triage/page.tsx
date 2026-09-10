"use client";

import { useState } from "react";

import { Wordmark, XsomMark } from "@/components/brand";
import { LanguageToggle, useT } from "@/lib/i18n";
import "./triage.css";

/**
 * Public profile diagnostic (`QO-7`, pillar 1).
 *
 * The argument the product is built on: the market shows a list of AI threats,
 * most of which are not this prospect's. Crossing their usage with what we
 * actually prove turns a catalogue into a number they can act on.
 *
 * Every figure here comes from the generated coverage map, through the API — the
 * page computes nothing. A screen that did its own arithmetic would be a second
 * reader of the registry, and two readers eventually disagree.
 */

const PROFILES = ["P1a", "P1b", "P2", "P3", "P4", "P5"] as const;

type Result = {
  lines: number;
  applicable: number;
  ours: number;
  blocked: number;
  statement: string;
  privacy: string;
};

export default function TriagePage() {
  const { t } = useT();
  const [picked, setPicked] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(profile: string) {
    setPicked((current) =>
      current.includes(profile)
        ? current.filter((p) => p !== profile)
        : [...current, profile],
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profiles: picked, email }),
      });
      if (res.ok) {
        setResult((await res.json()) as Result);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      setError(data.detail ?? t("triage.failed"));
    } catch {
      setError(t("triage.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="absolute right-6 top-6">
        <LanguageToggle />
      </div>
      <main className="guard-diagnostic mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 p-6">
        <div className="flex items-center gap-3">
          <XsomMark className="h-8 w-8" />
          <Wordmark />
        </div>

        {result ? (
          <section
            aria-labelledby="triage-result"
            className="animate-fade-up space-y-6"
          >
            <h1 id="triage-result" className="text-2xl font-semibold">
              {t("triage.title")}
            </h1>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(
                [
                  [result.lines, "triage.result.lines"],
                  [result.applicable, "triage.result.applicable"],
                  [result.ours, "triage.result.ours"],
                  [result.blocked, "triage.result.blocked"],
                ] as const
              ).map(([value, key]) => (
                <div
                  key={key}
                  className="rounded-lg border border-slate-200 p-4"
                >
                  <dt className="text-sm text-slate-500">{t(key)}</dt>
                  <dd className="text-3xl font-semibold tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {/* The sentence comes from the engine, not from the page: it is the
                claim the product is allowed to make, and FR-175 governs its verb. */}
            <p
              className="text-lg leading-relaxed"
              data-testid="triage-statement"
            >
              {result.statement}
            </p>
            {/* Rendered from the response so the purpose cannot drift from the
                collection it governs. */}
            <p className="text-xs leading-relaxed text-slate-500">
              {result.privacy}
            </p>
            <button
              type="button"
              className="text-sm underline"
              onClick={() => setResult(null)}
            >
              {t("triage.result.again")}
            </button>
          </section>
        ) : (
          <form onSubmit={onSubmit} className="animate-fade-up space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold">{t("triage.title")}</h1>
              <p className="leading-relaxed text-slate-600">
                {t("triage.lede")}
              </p>
            </div>

            <fieldset className="space-y-3">
              <legend className="font-medium">{t("triage.profiles")}</legend>
              {PROFILES.map((profile) => {
                const key = `triage.${profile.toLowerCase()}` as Parameters<
                  typeof t
                >[0];
                const hint = `${key}.hint` as Parameters<typeof t>[0];
                return (
                  <label
                    key={profile}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={picked.includes(profile)}
                      onChange={() => toggle(profile)}
                    />
                    <span>
                      <span className="block font-medium">{t(key)}</span>
                      <span className="block text-sm text-slate-500">
                        {t(hint)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <div className="space-y-2">
              <label className="block font-medium" htmlFor="triage-email">
                {t("triage.email")}
              </label>
              <input
                id="triage-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 p-2"
              />
              {/* Before the submit, not after: a purpose the reader meets only
                  once they have handed the data over was not disclosed. */}
              <p className="text-xs leading-relaxed text-slate-500">
                {t("triage.privacy.before")}
              </p>
            </div>

            {picked.length === 0 ? (
              <p className="text-sm text-slate-500">
                {t("triage.needprofile")}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy || picked.length === 0}
              className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-40"
            >
              {busy ? t("triage.busy") : t("triage.submit")}
            </button>
          </form>
        )}
      </main>
    </>
  );
}
