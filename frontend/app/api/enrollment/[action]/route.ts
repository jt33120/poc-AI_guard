import { NextResponse } from "next/server";
import { config } from "@/lib/config";

/** Native extension only. A code is confirmed separately by an authenticated admin. */
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!["start", "status", "cancel"].includes(action)) return NextResponse.json({}, { status: 404 });
  if (config.localPreview) return NextResponse.json({ detail: "Le raccordement nécessite la console connectée à votre entreprise." }, { status: 409 });
  const headers = { "Cache-Control": "no-store" };
  let endpoint: string;
  try {
    const url = new URL(config.extensionApiPublicUrl);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!local && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) throw new Error("Invalid endpoint");
    endpoint = url.href.replace(/\/$/, "");
  } catch { return NextResponse.json({ detail: "Le service de raccordement n’est pas configuré." }, { status: 503, headers }); }
  const credential = request.headers.get("x-gateway-token") ?? "";
  if (action !== "start" && !/^xsg_[A-Za-z0-9_-]{43}$/.test(credential)) return NextResponse.json({}, { status: 401, headers });
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > 4096) { await reader.cancel(); return NextResponse.json({}, { status: 413, headers }); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
  }
  try {
    const upstream = await fetch(`${config.controlApiUrl}/v1/extension-enrollment/${action}`, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", "X-Gateway-Token": credential },
      body: Buffer.concat(chunks).toString("utf8") || "{}",
    });
    if (!upstream.ok) return NextResponse.json({ detail: "Raccordement indisponible ou expiré." }, { status: upstream.status, headers });
    const data = await upstream.json();
    return NextResponse.json(action === "start" ? { ...data, endpoint } : data, { headers });
  } catch { return NextResponse.json({ detail: "Service de raccordement indisponible." }, { status: 503, headers }); }
}
