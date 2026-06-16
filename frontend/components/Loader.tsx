"use client";

import { useEffect, useState } from "react";

import { ShieldMark, Wordmark } from "@/components/brand";

// Branded full-screen loader — used while signing in and on route transitions.
// `slowLabel` (if given) fades in after a few seconds to reassure during a cold start.
export function FullScreenLoader({
  label = "Loading…",
  slowLabel,
}: {
  label?: string;
  slowLabel?: string;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!slowLabel) return;
    const id = setTimeout(() => setSlow(true), 7000);
    return () => clearTimeout(id);
  }, [slowLabel]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy/95 backdrop-blur-md">
      <div className="flex animate-fade-up flex-col items-center gap-6">
        <div className="relative grid h-24 w-24 place-items-center">
          <span className="absolute inset-0 rounded-full border border-white/10" />
          <span className="absolute inset-0 animate-ping rounded-full border border-brand/40" />
          <span className="absolute inset-1 animate-spin rounded-full border-2 border-transparent border-t-brand-bright" />
          <span className="absolute inset-3 rounded-full bg-brand/10 blur-md" />
          <ShieldMark className="relative h-8 w-8 text-brand-bright" />
        </div>
        <div className="text-center">
          <Wordmark className="text-base" />
          <p className="muted mt-1.5 flex items-center justify-center gap-1 text-sm">
            {label}
            <span className="inline-flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-white/40 [animation-delay:0ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-white/40 [animation-delay:150ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-white/40 [animation-delay:300ms]" />
            </span>
          </p>
          {slow && slowLabel ? (
            <p className="muted mx-auto mt-2 max-w-xs text-xs text-white/40">{slowLabel}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
