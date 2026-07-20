"use client";

import { useEffect, useState } from "react";

import { apiGet, apiSend } from "@/lib/client";
import { type StrKey, useT } from "@/lib/i18n";

interface DlpConfig {
  enabled: boolean;
  secret_action: string;
  pii_action: string;
  entropy_action: string;
  platform_enabled: boolean;
}

const FIELD =
  "rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-brand/50";

// The action choices offered per category (entropy can only flag or stay off).
const SECRET_PII: string[] = ["block", "redact", "flag", "off"];
const ENTROPY: string[] = ["flag", "off"];

const ACT_KEY: Record<string, StrKey> = {
  block: "dlp.act.block",
  redact: "dlp.act.redact",
  flag: "dlp.act.flag",
  off: "dlp.act.off",
};

export function DlpSettings() {
  const { t } = useT();
  const [cfg, setCfg] = useState<DlpConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<DlpConfig>("v1/dlp")
      .then(setCfg)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  function patch(next: Partial<DlpConfig>) {
    setSaved(false);
    setCfg((c) => (c ? { ...c, ...next } : c));
  }

  async function save() {
    if (!cfg) return;
    setBusy(true);
    setError(null);
    try {
      const out = await apiSend<DlpConfig>("v1/dlp", "PUT", {
        enabled: cfg.enabled,
        secret_action: cfg.secret_action,
        pii_action: cfg.pii_action,
        entropy_action: cfg.entropy_action,
      });
      setCfg(out);
      setSaved(true);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function row(label: StrKey, field: keyof DlpConfig, options: string[]) {
    return (
      <label className="flex items-center justify-between gap-3 border-b border-white/[0.06] py-2 last:border-0">
        <span className="text-sm text-white/80">{t(label)}</span>
        <select
          aria-label={t(label)}
          value={String(cfg?.[field] ?? "")}
          onChange={(e) => patch({ [field]: e.target.value } as Partial<DlpConfig>)}
          disabled={!cfg?.enabled}
          className={`${FIELD} disabled:opacity-40`}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {t(ACT_KEY[o])}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="card flex flex-col gap-4 p-6">
      <div>
        <h2 className="font-semibold">{t("dlp.title")}</h2>
        <p className="muted mt-1 text-sm">{t("dlp.subtitle")}</p>
      </div>

      {cfg && !cfg.platform_enabled ? (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-200">
          {t("dlp.platform.off")}
        </p>
      ) : null}

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={cfg?.enabled ?? false}
          onChange={(e) => patch({ enabled: e.target.checked })}
          className="h-4 w-4 accent-brand"
        />
        <span className="text-sm font-medium">{t("dlp.enabled")}</span>
      </label>

      <div className="flex flex-col">
        {row("dlp.cat.secret", "secret_action", SECRET_PII)}
        {row("dlp.cat.pii", "pii_action", SECRET_PII)}
        {row("dlp.cat.entropy", "entropy_action", ENTROPY)}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || !cfg}
          className="btn btn-primary px-4 py-2 disabled:opacity-50"
        >
          {t("dlp.save")}
        </button>
        {saved ? <span className="text-sm text-emerald-300">{t("dlp.saved")}</span> : null}
        {error ? <span className="text-sm text-red-300">{error}</span> : null}
      </div>
    </div>
  );
}
