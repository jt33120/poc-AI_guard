"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Wordmark, XsomMark } from "@/components/brand";
import { FullScreenLoader } from "@/components/Loader";
import { LanguageToggle, useT } from "@/lib/i18n";

export default function SignupPage() {
  const { t } = useT();
  const router = useRouter();
  const [org, setOrg] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org, email, password }),
    });
    if (res.ok) {
      setRedirecting(true);
      router.push("/home");
      router.refresh();
    } else {
      setBusy(false);
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      setError(data.detail ?? t("signup.failed"));
    }
  }

  return (
    <>
      {redirecting ? (
        <FullScreenLoader label={t("login.securing")} slowLabel={t("common.waking")} />
      ) : null}
      <div className="absolute right-6 top-6">
        <LanguageToggle />
      </div>
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-6 flex items-center gap-2.5">
            <XsomMark className="h-9 w-9" />
            <Wordmark className="text-lg" />
          </div>
          <div className="card p-6">
            <h1 className="text-xl font-bold">{t("signup.title")}</h1>
            <p className="muted mt-1 text-sm">{t("signup.subtitle")}</p>
            <form className="mt-5 flex flex-col gap-3" onSubmit={onSubmit}>
              <input
                aria-label={t("signup.org")}
                placeholder={t("signup.org")}
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                className="input"
                required
              />
              <input
                type="email"
                aria-label={t("signup.email")}
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                required
              />
              <input
                type="password"
                aria-label={t("signup.password")}
                placeholder={t("signup.password")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                minLength={8}
                required
              />
              <button type="submit" disabled={busy} className="btn btn-primary mt-1 w-full">
                {busy ? t("signup.submitting") : t("signup.submit")}
              </button>
              {error ? <p className="text-sm text-red-300">{error}</p> : null}
            </form>
            <p className="mt-4 text-center text-sm">
              <span className="muted">{t("signup.haveaccount")} </span>
              <Link href="/login" className="text-brand-bright hover:underline">
                {t("signup.signin")}
              </Link>
            </p>
          </div>
          <p className="muted mt-4 text-center text-xs">{t("signup.footer")}</p>
        </div>
      </main>
    </>
  );
}
