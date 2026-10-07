import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { config as appConfig } from "@/lib/config";
import { routeForSite, siteForHost } from "@/lib/sites";

const PROTECTED = [
  "/home",
  "/executive",
  "/inspector",
  "/approvals",
  "/audit",
  "/costs",
  "/admin",
  "/onboarding",
  "/policy",
  "/risk",
  "/settings",
  "/extensions",
  "/xsom",
  "/ai-guard",
  "/subscriptions",
];

export async function proxy(request: NextRequest) {
  // Segment-aware match, so a public path that merely starts like a console path is not caught.
  const path = request.nextUrl.pathname;
  // Chaque adresse publique montre son site (voir `lib/sites.ts`), avant tout le reste.
  // L'adresse vient de l'en-tête `Host` : `next start` remplit `nextUrl` avec sa propre
  // adresse d'écoute, pas avec celle que le visiteur a demandée.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const route = routeForSite(siteForHost(host), path, request.nextUrl.search);
  if (route.kind === "redirect") return NextResponse.redirect(route.url, 308);
  if (route.kind === "rewrite") {
    const target = request.nextUrl.clone();
    target.pathname = route.path;
    return NextResponse.rewrite(target);
  }
  // Native device-code initiation has no browser session; confirmation remains protected.
  if (["/api/enrollment/start", "/api/enrollment/status", "/api/enrollment/cancel"].includes(path)) {
    return NextResponse.next({ request });
  }
  if (appConfig.localPreview) {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(request.nextUrl.hostname)) {
      return new NextResponse("Local preview only", { status: 403 });
    }
    return NextResponse.next({ request });
  }
  const isProtected = PROTECTED.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );

  // Hermetic E2E mode: gate on a marker cookie instead of a real session.
  if (appConfig.e2e) {
    if (isProtected && !request.cookies.get("xsom_e2e")) {
      const login = new URL("/login", request.url);
      login.searchParams.set("next", path + request.nextUrl.search);
      return NextResponse.redirect(login);
    }
    return NextResponse.next({ request });
  }

  const response = NextResponse.next({ request });
  const supabase = createServerClient(
    appConfig.supabaseUrl,
    appConfig.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          toSet: { name: string; value: string; options: CookieOptions }[],
        ) {
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
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (isProtected && !user) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  // `icon.svg` est exclu au même titre que `favicon.ico` : c'est la route que Next sert
  // réellement pour l'icône d'onglet, et sans cette exclusion chaque requête de favicon
  // construit un client Supabase et appelle `auth.getUser()` — pour une image, sur
  // chaque chargement de page, y compris pour un visiteur non connecté. `xsom-mark.svg`
  // et sa variante claire tombent sous la même règle : le logo est demandé sur chaque
  // page, y compris par un visiteur non connecté.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|xsom-mark.svg|xsom-mark-light.svg|signal-media/|fonts/).*)",
  ],
};
