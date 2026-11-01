"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/** Disables itself while the enclosing form action is pending (prevents double-submits). */
export function SubmitButton({ children, pendingText, variant = "primary", name, value }: {
  children: ReactNode; pendingText?: string; variant?: "primary" | "ghost" | "danger"; name?: string; value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={`btn-${variant}`} aria-busy={pending}>
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}
