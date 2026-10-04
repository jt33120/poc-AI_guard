import { type NextRequest, NextResponse } from "next/server";

import { config } from "@/lib/config";
import { previewResponse } from "@/lib/console-preview";
import { canOpenProduct, isWorkspace, productForApi } from "@/lib/workspace";
import { routeAllowed } from "@/lib/controlRoutes";
import { getSession } from "@/lib/session";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

// Server-side proxy: the browser never sees the bearer token (CLAUDE.md §4.5).
async function forward(
  request: NextRequest,
  path: string[],
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
  // Le proxy attache le jeton de la session : sans liste blanche il relaierait
  // n'importe quelle méthode vers n'importe quel chemin, et le rôle du compte serait
  // l'unique contrôle de sécurité. La table dit ce que la console fait ; le reste est
  // refusé, y compris une route que l'API sert parfaitement (§4.4, fail-closed).
  //
  // 404 plutôt que 403 : ce proxy ne route pas ce chemin. Répondre « interdit »
  // apprendrait à un appelant quelles routes existent derrière.
  if (!routeAllowed(request.method, path)) {
    return NextResponse.json({ detail: "Not found" }, { status: 404 });
  }
  if (config.localPreview) {
    if (request.method !== "GET") {
      return NextResponse.json({ detail: "L’aperçu local ne modifie aucune donnée." }, { status: 409 });
    }
    const preview = previewResponse(path.join("/"));
    return preview === undefined
      ? NextResponse.json({ detail: "Donnée indisponible dans l’aperçu local." }, { status: 503 })
      : NextResponse.json(preview);
  }
  const product = productForApi(path.join("/"), request.nextUrl.searchParams);
  if (product) {
    try {
      const accessResponse = await fetch(`${config.controlApiUrl}/v1/workspace`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!accessResponse.ok) throw new Error("Workspace unavailable");
      const workspace: unknown = await accessResponse.json();
      if (!isWorkspace(workspace)) throw new Error("Invalid workspace");
      if (!workspace.subscriptions.some((s) => (product === "either" || s.product === product) && canOpenProduct(s))) {
        return NextResponse.json({ detail: "Product access required", product }, { status: 402 });
      }
    } catch {
      return NextResponse.json({ detail: "Product access could not be verified" }, { status: 503 });
    }
  }
  const target = `${config.controlApiUrl}/${path.join("/")}${request.nextUrl.search}`;
  const init: RequestInit = {
    method: request.method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": request.headers.get("content-type") ?? "application/json",
    },
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }
  let upstream: Response;
  try {
    upstream = await fetch(target, { ...init, cache: "no-store", signal: AbortSignal.timeout(15000) });
  } catch {
    return NextResponse.json({ detail: "Control API unavailable" }, { status: 503 });
  }
  // 204/304 carry no body — constructing a Response with a body for these
  // statuses throws (which surfaced as a spurious 500 on token revocation).
  if (upstream.status === 204 || upstream.status === 304) {
    return new NextResponse(null, { status: upstream.status });
  }
  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  return forward(request, (await ctx.params).path);
}
export async function POST(request: NextRequest, ctx: RouteContext) {
  return forward(request, (await ctx.params).path);
}
export async function PUT(request: NextRequest, ctx: RouteContext) {
  return forward(request, (await ctx.params).path);
}
export async function PATCH(request: NextRequest, ctx: RouteContext) {
  return forward(request, (await ctx.params).path);
}
export async function DELETE(request: NextRequest, ctx: RouteContext) {
  return forward(request, (await ctx.params).path);
}
