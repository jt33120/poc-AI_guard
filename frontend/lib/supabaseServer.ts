import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { config } from "@/lib/config";

// Tokens live in httpOnly cookies — never readable by client JS (CLAUDE.md §4.5).
const HTTP_ONLY: Partial<CookieOptions> = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
};

export function createSupabaseServerClient() {
  const store = cookies();
  return createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of toSet) {
            store.set(name, value, { ...options, ...HTTP_ONLY });
          }
        } catch {
          // Invoked from a Server Component (cannot set cookies); the middleware
          // refreshes the session cookies instead.
        }
      },
    },
  });
}
