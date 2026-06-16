import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabaseServer";

// Completes a password reset: exchanges the recovery code (from the email link)
// for a session, sets the new password, then signs out so no session lingers.
export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    code?: unknown;
    password?: unknown;
  };
  const { code, password } = payload;
  if (typeof code !== "string" || typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { detail: "A reset code and a password of at least 8 characters are required" },
      { status: 400 },
    );
  }
  const supabase = createSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.json(
      { detail: "This reset link is invalid or has expired — request a new one." },
      { status: 400 },
    );
  }
  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    return NextResponse.json({ detail: updateError.message }, { status: 400 });
  }
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
