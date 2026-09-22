import { NextRequest, NextResponse } from "next/server";

import { THREAT_GLOSSARY } from "@/lib/threat-glossary";
import type { Lang } from "@/lib/strings";

export const runtime = "nodejs";

type MistralResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const requestTimes = new Map<string, number[]>();
const MAX_REQUESTS_PER_MINUTE = 12;

function clientId(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function isRateLimited(request: NextRequest) {
  const now = Date.now();
  const id = clientId(request);
  const recent = (requestTimes.get(id) ?? []).filter((time) => now - time < 60_000);
  recent.push(now);
  requestTimes.set(id, recent);
  return recent.length > MAX_REQUESTS_PER_MINUTE;
}

function catalogue(lang: Lang) {
  return THREAT_GLOSSARY.map((entry) => ({
    id: entry.id,
    title: entry.copy[lang].title,
    attack: entry.copy[lang].attack,
    mitigation: entry.copy[lang].mitigation,
  }));
}

export async function POST(request: NextRequest) {
  if (isRateLimited(request)) {
    return NextResponse.json({ detail: "Too many requests" }, { status: 429 });
  }

  const body: unknown = await request.json().catch(() => null);
  const query = typeof (body as { query?: unknown })?.query === "string"
    ? (body as { query: string }).query.trim().slice(0, 600)
    : "";
  const lang: Lang = (body as { lang?: unknown })?.lang === "en" ? "en" : "fr";
  if (query.length < 3) return NextResponse.json({ ids: [] });

  const apiKey = process.env.MISTRAL_API_KEY_SEARCHFRONTEND;
  if (!apiKey) return NextResponse.json({ detail: "Search unavailable" }, { status: 503 });

  const upstream = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "mistral-small-latest",
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You classify an AI security concern against a closed catalogue. Return JSON only: {\\\"ids\\\":[...]} with at most 12 relevant catalogue ids, in relevance order. Never invent an id. Return an empty list when nothing applies.",
        },
        {
          role: "user",
          content: JSON.stringify({ concern: query, catalogue: catalogue(lang) }),
        },
      ],
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!upstream.ok) return NextResponse.json({ detail: "Search unavailable" }, { status: 503 });

  const completion = (await upstream.json()) as MistralResponse;
  const content = completion.choices?.[0]?.message?.content;
  if (typeof content !== "string") return NextResponse.json({ detail: "Search unavailable" }, { status: 503 });

  try {
    const result: unknown = JSON.parse(content);
    const knownIds = new Set(THREAT_GLOSSARY.map((entry) => entry.id));
    const ids = Array.isArray((result as { ids?: unknown })?.ids)
      ? (result as { ids: unknown[] }).ids.filter((id): id is string => typeof id === "string" && knownIds.has(id)).slice(0, 12)
      : [];
    return NextResponse.json({ ids });
  } catch {
    return NextResponse.json({ detail: "Search unavailable" }, { status: 503 });
  }
}
