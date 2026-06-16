import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabaseServer";

// Requests a password-reset email. Always returns ok — never reveal whether an
// address has an account (avoids account enumeration).
export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as { email?: unknown };
  const { email } = payload;
  if (typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ detail: "A valid email is required" }, { status: 400 });
  }
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  const supabase = createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/reset` });
  return NextResponse.json({ ok: true });
}
