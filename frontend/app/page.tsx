import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold">xSOM AI Guard</h1>
      <p className="text-slate-600">
        An MCP action-control gateway: every agent tool-call is authorized, held for human
        approval when irreversible, and recorded in an immutable audit trail.
      </p>
      <div className="flex gap-3">
        <Link
          href="/login"
          className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700"
        >
          Sign in
        </Link>
        <Link
          href="/inspector"
          className="rounded border border-slate-300 px-4 py-2 font-medium hover:bg-slate-100"
        >
          Open console
        </Link>
      </div>
    </main>
  );
}
