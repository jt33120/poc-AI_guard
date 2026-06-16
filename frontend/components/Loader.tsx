import { ShieldMark, Wordmark } from "@/components/brand";

// Branded full-screen loader — used while signing in and on route transitions.
export function FullScreenLoader({ label = "Loading…" }: { label?: string }) {
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
        </div>
      </div>
    </div>
  );
}
