export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 p-8 text-sm text-white/50">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/15 border-t-brand-bright" />
      {label}
    </div>
  );
}
