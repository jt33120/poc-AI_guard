export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex cursor-help align-middle">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-56 -translate-x-1/2
                   rounded-lg border border-white/10 bg-navy-mid px-3 py-2 text-center text-xs font-normal
                   leading-snug text-white/80 shadow-card group-hover:block"
      >
        {label}
      </span>
    </span>
  );
}
