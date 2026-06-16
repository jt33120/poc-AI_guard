import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { config as appConfig } from "@/lib/config";

const PROTECTED = ["/home", "/inspector", "/approvals", "/audit", "/admin"];

export async function middleware(request: NextRequest) {
  const isProtected = PROTECTED.some((p) => request.nextUrl.pathname.startsWith(p));

  // Hermetic E2E mode: gate on a marker cookie instead of a real session.
  if (appConfig.e2e) {
    if (isProtected && !request.cookies.get("xsom_e2e")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next({ request });
  }

  const response = NextResponse.next({ request });
  const supabase = createServerClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
          });
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (isProtected && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
