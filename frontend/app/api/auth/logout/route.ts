import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
