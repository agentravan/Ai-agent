export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-white">
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#e8b64c" />
        <path d="M7 22 10 11l6 6 6-6 3 11z" fill="#0b1020" />
      </svg>
      {!compact && <span>AI Empire <span className="text-gold">OS</span></span>}
    </span>
  );
}
