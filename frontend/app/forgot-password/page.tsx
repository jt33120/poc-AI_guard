"use client";

import Link from "next/link";
import { useState } from "react";

import { Wordmark, XsomMark } from "@/components/brand";
import { LanguageToggle, useT } from "@/lib/i18n";

export default function ForgotPasswordPage() {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => undefined);
    setBusy(false);
    setSent(true);
  }

  return (
    <>
      <div className="absolute right-6 top-6">
        <LanguageToggle />
      </div>
      <main className="console-shell signal-auth flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-6 flex items-center gap-2.5">
            <XsomMark className="h-9 w-9" />
            <Wordmark className="text-lg" />
          </div>
          <div className="card p-6">
            <h1 className="text-xl font-bold">{t("forgot.title")}</h1>
            <p className="muted mt-1 text-sm">{t("forgot.subtitle")}</p>
            {sent ? (
              <p className="mt-5 rounded-xl border border-brand/30 bg-brand/10 px-4 py-3 text-sm text-brand-bright">
                {t("forgot.sent")}
              </p>
            ) : (
              <form className="mt-5 flex flex-col gap-3" onSubmit={onSubmit}>
                <input
                  type="email"
                  aria-label={t("login.email")}
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input"
                  required
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="btn btn-primary mt-1 w-full"
                >
                  {busy ? t("forgot.sending") : t("forgot.submit")}
                </button>
              </form>
            )}
            <p className="mt-4 text-center text-sm">
              <Link href="/login" className="text-brand-bright hover:underline">
                {t("forgot.back")}
              </Link>
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
