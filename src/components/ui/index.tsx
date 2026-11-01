import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Inbox, type LucideIcon } from "lucide-react";
import { cn, humanize } from "@/lib/utilities/format";

export function Card({ title, description, action, children, className, flush }: {
  title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean;
}) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-line bg-panel/80 shadow-[0_1px_0_0_rgb(255_255_255/0.03)_inset,0_8px_24px_-12px_rgb(0_0_0/0.5)]", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="truncate text-[13px] font-semibold text-zinc-100">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

const TONES = {
  good: { box: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20", dot: "bg-emerald-400" },
  warn: { box: "bg-amber-500/10 text-amber-300 ring-amber-500/20", dot: "bg-amber-400" },
  bad: { box: "bg-rose-500/10 text-rose-300 ring-rose-500/20", dot: "bg-rose-400" },
  info: { box: "bg-sky-500/10 text-sky-300 ring-sky-500/20", dot: "bg-sky-400" },
  neutral: { box: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/20", dot: "bg-zinc-400" },
  gold: { box: "bg-gold/10 text-gold ring-gold/25", dot: "bg-gold" },
} as const;
export type Tone = keyof typeof TONES;

const STATUS_TONE: Record<string, Tone> = {
  active: "good", succeeded: "good", done: "good", approved: "good", completed: "good", won: "good", executed: "good",
  running: "info", in_progress: "info", evaluating: "info", queued: "info", planned: "info", proposed: "info",
  pending: "warn", blocked: "warn", on_hold: "warn", todo: "neutral", approval: "warn", high: "warn",
  suspended: "bad", failed: "bad", rejected: "bad", cancelled: "neutral", lost: "bad", denied: "bad", critical: "bad",
  low: "neutral", medium: "neutral",
};

/** Status pill with a leading dot — calm, readable, consistent everywhere. */
export function Badge({ children, tone }: { children: string; tone?: Tone }) {
  const t = TONES[tone ?? STATUS_TONE[children] ?? "neutral"];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] leading-4 font-medium ring-1 ring-inset", t.box)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} aria-hidden />
      {humanize(children)}
    </span>
  );
}

export function PageHeader({ title, subtitle, action, eyebrow }: { title: string; subtitle?: string; action?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1.5 text-[11px] font-medium tracking-[0.14em] text-gold uppercase">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold text-zinc-50 sm:text-[28px] sm:leading-9">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, icon: Icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-line bg-panel/80 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-zinc-500" aria-hidden />}
      </div>
      <div className={cn("num mt-2 text-2xl font-semibold tracking-tight", tone === "bad" ? "text-rose-300" : tone === "good" ? "text-emerald-300" : "text-zinc-50")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Empty({ children, icon: Icon = Inbox }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-4 py-8 text-center">
      <Icon className="h-5 w-5 text-zinc-600" aria-hidden />
      <p className="max-w-sm text-sm text-muted">{children}</p>
    </div>
  );
}

export function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Select({ name, options, defaultValue, placeholder, required }: {
  name: string; options: readonly (string | { value: string; label: string })[]; defaultValue?: string | null; placeholder?: string; required?: boolean;
}) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} required={required} className="input pr-8">
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const { value, label } = typeof o === "string" ? { value: o, label: humanize(o) } : o;
        return <option key={value} value={value}>{label}</option>;
      })}
    </select>
  );
}

export function Flash({ params }: { params: Record<string, string | string[] | undefined> }) {
  const ok = typeof params.ok === "string" ? params.ok : null;
  const error = typeof params.error === "string" ? params.error : null;
  if (!ok && !error) return null;
  const Icon = error ? AlertTriangle : CheckCircle2;
  return (
    <div role="status" className={cn("mb-6 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm", error ? "border-rose-500/30 bg-rose-500/[0.06] text-rose-200" : "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200")}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{(error ?? ok)?.slice(0, 500)}</span>
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="-mx-4 -my-4 overflow-x-auto sm:-mx-5 sm:-my-5">
      <table className="w-full min-w-[600px] text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-panel-2/50 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
            {head.map((h) => <th key={h} className="px-4 py-2.5 font-medium first:pl-4 sm:first:pl-5">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&>tr]:transition-colors [&>tr:hover]:bg-white/[0.015]">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cn("px-4 py-3 align-middle first:pl-4 sm:first:pl-5", className)}>{children}</td>
);

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
