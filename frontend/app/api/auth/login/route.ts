import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST(request: Request) {
  const payload = (await request.json()) as { email?: unknown; password?: unknown };
  const { email, password } = payload;
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ detail: "email and password are required" }, { status: 400 });
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ detail: error.message }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
