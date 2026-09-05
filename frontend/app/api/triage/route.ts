import { NextResponse } from "next/server";

import { config } from "@/lib/config";

/**
 * Public profile diagnostic (`QO-7`).
 *
 * A thin proxy: the browser never reaches the control API directly, and the
 * backend stays the only place that decides what may be claimed. The e-mail is
 * forwarded and **never** stored or logged here — the backend owns the retention
 * and the purpose statement that travels back with the answer.
 */
export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    profiles?: unknown;
    email?: unknown;
  };
  const { profiles, email } = payload;
  if (!Array.isArray(profiles) || profiles.length === 0 || typeof email !== "string") {
    return NextResponse.json({ detail: "profiles and email are required" }, { status: 400 });
  }

  const res = await fetch(`${config.controlApiUrl}/v1/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profiles, email }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // The backend's own message when it has one — it is the side that knows why
    // (rate limit, map unavailable, invalid address).
    return NextResponse.json(
      { detail: (data as { detail?: string }).detail ?? "Diagnostic failed" },
      { status: res.status },
    );
  }
  return NextResponse.json(data);
}
