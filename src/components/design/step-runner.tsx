"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { advanceDesignAction } from "@/modules/design/actions";
import { lensLabel } from "@/modules/design/logic";

const STEP_TEXT: Record<string, string> = {
  brief: "Gaja wrote the brief",
  challenge: "Meen challenged the brief",
  draft: "Gaja wrote the draft",
};

/**
 * Runs the Design Studio's AI steps one server call at a time (each fits the serverless limit) and refreshes the page
 * after each one. Starts by itself when `autoStart` (no stored error), otherwise on click.
 */
export function StepRunner({ id, label, working, autoStart }: { id: string; label: string; working: string; autoStart: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus(working);
    try {
      for (let i = 0; i < 6; i++) {
        const r = await advanceDesignAction(id);
        if (!r.ok) { setError(r.error); break; }
        if (r.step) setStatus(STEP_TEXT[r.step] ?? `${lensLabel(r.step)} review done`);
        router.refresh();
        if (!r.more) break;
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      void run();
    }
  }, [autoStart]); // run() is stable enough: it only ever starts once here

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn-gold" onClick={run} disabled={busy} aria-busy={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        {busy ? working : label}
      </button>
      {status && !error && <span className="text-xs text-zinc-400" role="status">{status}</span>}
      {error && <span className="text-xs text-rose-300" role="alert">{error}</span>}
    </div>
  );
}
