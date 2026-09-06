import { NextResponse } from "next/server";

import { config } from "@/lib/config";

/**
 * Le relevé des menaces, positionné pour les profils demandés (`L3`).
 *
 * Un proxy mince, comme `/api/triage` : le navigateur ne joint jamais la control API
 * directement, et le backend reste le seul endroit qui décide de ce qui peut être
 * revendiqué. Aucune donnée personnelle ne passe ici — c'est toute la différence
 * avec le diagnostic, qui demande une adresse.
 *
 * Les chiffres ne sont **pas** recalculés en chemin. Les recalculer donnerait un
 * second moteur, et le premier désaccord entre les deux se lirait sur une page
 * commerciale.
 */
export async function GET(request: Request) {
  const profiles = new URL(request.url).searchParams.get("profiles") ?? "";

  const res = await fetch(
    `${config.controlApiUrl}/v1/threats?profiles=${encodeURIComponent(profiles)}`,
    { cache: "no-store" },
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // Le message du backend quand il en a un : c'est le côté qui sait pourquoi
    // (limite de débit, carte indisponible, profil inconnu).
    return NextResponse.json(
      { detail: (data as { detail?: string }).detail ?? "Relevé indisponible" },
      { status: res.status },
    );
  }
  return NextResponse.json(data);
}
