export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));
}

export function formatInr(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(cents / 100);
}

/** Large INR amounts in words: ₹9.5 lakh crore, ₹120 crore, ₹4.2 lakh. Smaller amounts use formatInr. */
export function formatInrCompact(cents: number): string {
  const rupees = cents / 100;
  const fmt = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: n < 10 ? 2 : n < 100 ? 1 : 0 }).format(n);
  if (rupees >= 1e12) return `₹${fmt(rupees / 1e12)} lakh crore`;
  if (rupees >= 1e7) return `₹${fmt(rupees / 1e7)} crore`;
  if (rupees >= 1e5) return `₹${fmt(rupees / 1e5)} lakh`;
  return formatInr(cents);
}

/** $100 billion, $2.5 million, $80,000. */
export function formatUsdCompact(usd: number): string {
  const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
  if (usd >= 1e9) return `$${fmt(usd / 1e9)} billion`;
  if (usd >= 1e6) return `$${fmt(usd / 1e6)} million`;
  return `$${fmt(usd)}`;
}

export const humanize = (s: string) => s.replace(/[_.]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
