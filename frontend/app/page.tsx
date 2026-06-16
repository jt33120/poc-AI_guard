import Link from "next/link";

import { Logo } from "@/components/brand";

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-2xl animate-fade-up text-center">
        <div className="mb-6 flex justify-center">
          <Logo size="h-12 w-12" />
        </div>
        <span className="badge badge-blue">MCP action-control gateway</span>
        {/* Heading text stays exactly "xSOM AI Guard" for its accessible name. */}
        <h1 className="mt-5 text-4xl font-extrabold tracking-tight sm:text-5xl">
          xSOM <span className="text-brand-bright">AI Guard</span>
        </h1>
        <p className="muted mx-auto mt-4 max-w-xl text-base leading-relaxed">
          Every agent tool-call is authorized, held for human approval when irreversible, and
          recorded in an immutable, hash-chained audit trail.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login" className="btn btn-primary">
            Sign in
          </Link>
          <Link href="/inspector" className="btn btn-ghost">
            Open console
          </Link>
        </div>
      </div>
    </main>
  );
}
