import { type NextRequest, NextResponse } from "next/server";

import { config } from "@/lib/config";
import { getSession } from "@/lib/session";

interface RouteContext {
  params: { path: string[] };
}

// Server-side proxy: the browser never sees the bearer token (CLAUDE.md §4.5).
async function forward(request: NextRequest, path: string[]): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
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
  const upstream = await fetch(target, init);
  // 204/304 carry no body — constructing a Response with a body for these
  // statuses throws (which surfaced as a spurious 500 on token revocation).
  if (upstream.status === 204 || upstream.status === 304) {
    return new NextResponse(null, { status: upstream.status });
  }
  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export function GET(request: NextRequest, ctx: RouteContext) {
  return forward(request, ctx.params.path);
}
export function POST(request: NextRequest, ctx: RouteContext) {
  return forward(request, ctx.params.path);
}
export function PUT(request: NextRequest, ctx: RouteContext) {
  return forward(request, ctx.params.path);
}
export function PATCH(request: NextRequest, ctx: RouteContext) {
  return forward(request, ctx.params.path);
}
export function DELETE(request: NextRequest, ctx: RouteContext) {
  return forward(request, ctx.params.path);
}
