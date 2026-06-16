"use client";

import { useEffect, useState } from "react";

// `slowLabel` (if given) appears after a few seconds — reassures the user during
// a backend cold start instead of leaving a silent spinner that looks frozen.
export function Spinner({ label = "Loading…", slowLabel }: { label?: string; slowLabel?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!slowLabel) return;
    const id = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(id);
  }, [slowLabel]);
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-white/50">
      <div className="flex items-center gap-2.5">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/15 border-t-brand-bright" />
        {label}
      </div>
      {slow && slowLabel ? <p className="max-w-xs text-xs text-white/40">{slowLabel}</p> : null}
    </div>
  );
}
