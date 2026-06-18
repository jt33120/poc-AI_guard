import { NextResponse } from "next/server";

import { config } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    org?: unknown;
    email?: unknown;
    password?: unknown;
  };
  const { org, email, password } = payload;
  if (typeof org !== "string" || typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ detail: "org, email and password are required" }, { status: 400 });
  }

  // 1) Provision the tenant + admin user on the backend (holds the service-role
  //    key — never the frontend, CLAUDE.md §4.6).
  const res = await fetch(`${config.controlApiUrl}/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ org, email, password }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string };
    return NextResponse.json({ detail: data.detail ?? "Signup failed" }, { status: res.status });
  }

  // 2) Sign the new user in — sets the httpOnly session cookies. Their JWT now
  //    carries app_metadata.tenant_id/role (set during provisioning).
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ detail: error.message }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
