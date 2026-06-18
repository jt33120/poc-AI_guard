"use client";

// Provider glyphs as inline SVG (no external assets / no network). Monochrome
// line icons on a brand-tinted tile — a clean, professional provider chip.

const BRAND: Record<string, string> = {
  openai: "#10A37F",
  anthropic: "#CC785C",
  mistral: "#FA520F",
  openrouter: "#6366F1",
  langchain: "#1C8C6A",
  mcp: "#8B5CF6",
  http: "#64748B",
};

function Glyph({ id }: { id: string }) {
  switch (id) {
    case "openai": // AI sparkle (4-point star)
      return <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />;
    case "anthropic": // burst / asterisk
      return <path d="M12 3v18M4.5 6.5l15 11M19.5 6.5l-15 11" />;
    case "mistral": // pixel grid (filled)
      return (
        <g fill="currentColor" stroke="none">
          {[4, 10, 16].map((x) =>
            [4, 10, 16].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="4" height="4" rx="1" />),
          )}
        </g>
      );
    case "openrouter": // hub + spokes
      return (
        <>
          <circle cx="12" cy="12" r="2.5" />
          <path d="M12 4v3.5M12 16.5V20M4 12h3.5M16.5 12H20" />
        </>
      );
    case "langchain": // link
      return <path d="M9.5 14.5l5-5M8 12l-2 2a3.5 3.5 0 005 5l2-2M16 12l2-2a3.5 3.5 0 00-5-5l-2 2" />;
    case "mcp": // plug
      return <path d="M9 3v5M15 3v5M7 8h10v2a5 5 0 01-10 0zM12 15v6" />;
    default: // http / custom — code chevrons
      return <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />;
  }
}

export function ProviderIcon({ id, className }: { id: string; className?: string }) {
  const fillGlyph = id === "openai" || id === "mistral";
  return (
    <span
      style={{ backgroundColor: BRAND[id] ?? BRAND.http }}
      className={`grid shrink-0 place-items-center rounded-lg text-white ${className ?? "h-7 w-7"}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill={fillGlyph ? "currentColor" : "none"}
        stroke={fillGlyph ? "none" : "currentColor"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <Glyph id={id} />
      </svg>
    </span>
  );
}
