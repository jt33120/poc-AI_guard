// Shared brand bits: the shield mark, the wordmark, and status badges.

export function ShieldMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  // Text content stays "xSOM AI Guard" so its accessible name is unchanged.
  return (
    <span className={`font-bold tracking-tight ${className}`}>
      xSOM <span className="font-medium text-white/50">AI Guard</span>
    </span>
  );
}

export function Logo({ size = "h-8 w-8" }: { size?: string }) {
  return (
    <span
      className={`grid ${size} place-items-center rounded-xl bg-brand/15 text-brand-bright ring-1 ring-brand/30`}
    >
      <ShieldMark />
    </span>
  );
}

function badgeClass(value: string | null | undefined): string {
  const v = (value ?? "").toLowerCase();
  if (v.includes("deny") || v.includes("denied") || v.includes("error")) return "badge-red";
  if (v.includes("allow") || v.includes("approved") || v.includes("auto")) return "badge-green";
  if (v.includes("pending") || v.includes("hitl") || v.includes("expired")) return "badge-amber";
  if (v.includes("flag") || v.includes("redact")) return "badge-amber";
  return "badge-neutral";
}

export function DecisionBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-white/30">—</span>;
  return <span className={`badge ${badgeClass(value)}`}>{value}</span>;
}
