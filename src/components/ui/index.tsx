import type { ReactNode } from "react";
import { cn, humanize } from "@/lib/utilities/format";

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-line bg-panel p-4 sm:p-5", className)}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold text-slate-200">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const TONES: Record<string, string> = {
  good: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  warn: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  bad: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  info: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  neutral: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
  gold: "bg-gold/15 text-gold ring-gold/30",
};

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  active: "good", succeeded: "good", done: "good", approved: "good", completed: "good", won: "good", executed: "good",
  running: "info", in_progress: "info", evaluating: "info", queued: "info", planned: "info", proposed: "info",
  pending: "warn", blocked: "warn", on_hold: "warn", todo: "neutral", approval: "warn", high: "warn",
  suspended: "bad", failed: "bad", rejected: "bad", cancelled: "neutral", lost: "bad", denied: "bad", critical: "bad",
  low: "neutral", medium: "neutral",
  ceo: "gold", coo: "gold", executive: "info", manager: "neutral", worker: "neutral",
};

export function Badge({ children, tone }: { children: string; tone?: keyof typeof TONES }) {
  const t = tone ?? STATUS_TONE[children] ?? "neutral";
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", TONES[t])}>{humanize(children)}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-xs tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Select({ name, options, defaultValue, placeholder, required }: {
  name: string; options: readonly (string | { value: string; label: string })[]; defaultValue?: string | null; placeholder?: string; required?: boolean;
}) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} required={required} className="input">
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
  return (
    <div role="status" className={cn("mb-5 rounded-lg border px-4 py-3 text-sm", error ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200")}>
      {(error ?? ok)?.slice(0, 500)}
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="text-xs tracking-wide text-muted uppercase">
          <tr>{head.map((h) => <th key={h} className="px-4 py-2 font-medium sm:px-3">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cn("px-4 py-2.5 align-top sm:px-3", className)}>{children}</td>
);

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
