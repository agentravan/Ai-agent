"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Play, Square, XCircle } from "lucide-react";
import { autopilotStepAction, type AutopilotStep } from "@/modules/tasks/actions";

type LogLine = { ok: boolean; text: string };

/**
 * Live "team at work" view: runs ready tasks one by one (each a separate server request, so it
 * never hits serverless time limits) and shows who is doing what in plain language.
 */
export function Autopilot({ projectId = null, next, aiAvailable }: { projectId?: string | null; next: { title: string; agent: string } | null; aiAvailable: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(next);
  const [log, setLog] = useState<LogLine[]>([]);
  const stop = useRef(false);

  async function start() {
    stop.current = false;
    setRunning(true);
    setLog([]);
    let step: AutopilotStep = { done: false };
    while (!stop.current) {
      step = await autopilotStepAction(projectId);
      if (step.result) setLog((l) => [...l, { ok: step.result!.ok, text: step.result!.message }]);
      if (step.error) setLog((l) => [...l, { ok: false, text: step.error! }]);
      setCurrent(step.next ?? null);
      if (step.done) break;
    }
    setRunning(false);
    router.refresh();
  }

  if (!aiAvailable) return <p className="text-sm text-amber-300">AI is not connected — the team cannot work yet.</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {!running ? (
          <button onClick={start} disabled={!current && !log.length} className="btn-gold"><Play className="h-4 w-4" />Start work</button>
        ) : (
          <button onClick={() => { stop.current = true; }} className="btn-ghost"><Square className="h-4 w-4" />Stop after this task</button>
        )}
        <span className="text-sm text-zinc-400">
          {running && current ? <span className="flex items-center gap-2 text-sky-300"><Loader2 className="h-4 w-4 animate-spin" />{current.agent} is working on “{current.title}”…</span>
            : running ? <span className="flex items-center gap-2 text-sky-300"><Loader2 className="h-4 w-4 animate-spin" />Working…</span>
            : current ? <>Next up: <span className="text-zinc-200">{current.agent}</span> → {current.title}</>
            : log.length ? "All ready tasks are done. Read the results in Projects & Tasks." : "No tasks waiting. Give Atlas an instruction first."}
        </span>
      </div>
      {log.length > 0 && (
        <ul className="mt-4 space-y-1.5 rounded-lg border border-line bg-panel-2/40 p-3">
          {log.map((l, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              {l.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />}
              <span className={l.ok ? "text-zinc-200" : "text-rose-200"}>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-zinc-500">Each task takes about 30–90 seconds with the free AI model. Keep this page open while it works.</p>
    </div>
  );
}
