import { cookies } from "next/headers";

import { config } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export type Role = "admin" | "operator" | "viewer";

export interface Session {
  userId: string;
  tenantId: string | null;
  role: Role | null;
  accessToken: string;
}

export async function getSession(): Promise<Session | null> {
  // Hermetic E2E bypass: a marker cookie stands in for a real Supabase session.
  if (config.e2e && cookies().get("xsom_e2e")) {
    return { userId: "e2e-user", tenantId: "e2e-tenant", role: "admin", accessToken: "e2e-token" };
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const appMeta = (user.app_metadata ?? {}) as { tenant_id?: string; role?: Role };
  return {
    userId: user.id,
    tenantId: appMeta.tenant_id ?? null,
    role: appMeta.role ?? null,
    accessToken: session?.access_token ?? "",
  };
}
