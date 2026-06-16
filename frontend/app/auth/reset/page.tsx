"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Logo, Wordmark } from "@/components/brand";
import { LanguageToggle, useT } from "@/lib/i18n";

export default function ResetPasswordPage() {
  const { t } = useT();
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // The recovery code arrives as ?code=… on the email link.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCode(params.get("code"));
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("reset.tooshort"));
      return;
    }
    if (password !== confirm) {
      setError(t("reset.mismatch"));
      return;
    }
    setBusy(true);
    const res = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, password }),
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      setTimeout(() => router.push("/login"), 1600);
    } else {
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      setError(data.detail ?? t("reset.invalid"));
    }
  }

  return (
    <>
      <div className="absolute right-6 top-6">
        <LanguageToggle />
      </div>
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-6 flex items-center gap-2.5">
            <Logo size="h-9 w-9" />
            <Wordmark className="text-lg" />
          </div>
          <div className="card p-6">
            <h1 className="text-xl font-bold">{t("reset.title")}</h1>
            <p className="muted mt-1 text-sm">{t("reset.subtitle")}</p>
            {done ? (
              <p className="mt-5 rounded-xl border border-brand/30 bg-brand/10 px-4 py-3 text-sm text-brand-bright">
                {t("reset.success")}
              </p>
            ) : !code ? (
              <p className="mt-5 text-sm text-red-300">{t("reset.invalid")}</p>
            ) : (
              <form className="mt-5 flex flex-col gap-3" onSubmit={onSubmit}>
                <input
                  type="password"
                  aria-label={t("reset.password")}
                  placeholder={t("reset.password")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  required
                />
                <input
                  type="password"
                  aria-label={t("reset.confirm")}
                  placeholder={t("reset.confirm")}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="input"
                  required
                />
                <button type="submit" disabled={busy} className="btn btn-primary mt-1 w-full">
                  {busy ? t("reset.saving") : t("reset.submit")}
                </button>
                {error ? <p className="text-sm text-red-300">{error}</p> : null}
              </form>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
