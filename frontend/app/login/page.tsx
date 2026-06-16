"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Logo, Wordmark } from "@/components/brand";
import { FullScreenLoader } from "@/components/Loader";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      // Keep the loader up through the redirect + first console paint.
      setRedirecting(true);
      router.push("/inspector");
      router.refresh();
    } else {
      setBusy(false);
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      setError(data.detail ?? "Sign in failed");
    }
  }

  return (
    <>
      {redirecting ? <FullScreenLoader label="Securing your session" /> : null}
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo size="h-9 w-9" />
          <Wordmark className="text-lg" />
        </div>
        <div className="card p-6">
          <h1 className="text-xl font-bold">Sign in</h1>
          <p className="muted mt-1 text-sm">Access the action-control console.</p>
          <form className="mt-5 flex flex-col gap-3" onSubmit={onSubmit}>
            <input
              type="email"
              aria-label="Email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              required
            />
            <input
              type="password"
              aria-label="Password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              required
            />
            <button type="submit" disabled={busy} className="btn btn-primary mt-1 w-full">
              {busy ? "Signing in…" : "Sign in"}
            </button>
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
          </form>
        </div>
        <p className="muted mt-4 text-center text-xs">
          Every agent action — authorized, gated, and logged.
        </p>
      </div>
    </main>
    </>
  );
}
