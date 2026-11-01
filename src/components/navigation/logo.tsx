export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-b from-[#e6c88e] to-[#b8904a] shadow-[0_0_0_1px_rgb(255_255_255/0.15)_inset,0_4px_12px_-4px_rgb(212_175_106/0.5)]">
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path d="M4 17.5 5.6 8l4.2 4.1L12 6l2.2 6.1L18.4 8 20 17.5z" fill="#0b0b0d" />
        </svg>
      </span>
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight text-zinc-50">
          AI Empire <span className="font-normal text-zinc-500">OS</span>
        </span>
      )}
    </span>
  );
}
