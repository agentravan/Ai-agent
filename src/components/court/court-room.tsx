"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Gavel, Play, RotateCcw, Scale, Volume2, VolumeX } from "lucide-react";
import { advanceTrialAction } from "@/modules/court/actions";
import { JURY, RISK_LABEL, tally, VERDICT_LABEL, type Vote } from "@/modules/court/logic";
import type { Trial } from "@/modules/court/service";
import { hasNaturalVoice, speakLine, type VoiceGender } from "@/components/board/voices";

type Who = "judge" | "prosecutor" | "defence" | "jury";
const CAST: Record<Who, { name: string; role: string; color: string; gender: VoiceGender; slot: number }> = {
  judge: { name: "Justice Nyaya", role: "Judge", color: "#b45309", gender: "male", slot: 0 },
  prosecutor: { name: "Adv. Meera", role: "Prosecutor · Against", color: "#dc2626", gender: "female", slot: 0 },
  defence: { name: "Adv. Arjun", role: "Defence · For", color: "#2563eb", gender: "male", slot: 1 },
  jury: { name: "Jury", role: "12 jurors", color: "#0f766e", gender: "female", slot: 1 },
};
const VOTE_STYLE: Record<Vote, string> = { build: "bg-emerald-500 text-white", fix: "bg-amber-400 text-zinc-900", kill: "bg-rose-600 text-white" };

interface Line { who: Who; text: string; show: "exhibit" | "weak" | `q${number}` | `a${number}` | "team" | "jury" | "verdict" | "none" }

/** The trial as a script, built from whatever stages are ready. */
function script(t: Trial): Line[] {
  const lines: Line[] = [{ who: "judge", text: `Court is in session. Exhibit A${t.proposed_by ? `, from ${t.proposed_by}` : ""}: ${t.idea}`, show: "exhibit" }];
  if (!t.prosecution) return lines;
  lines.push({ who: "prosecutor", text: t.prosecution.opening, show: "none" });
  const weak = t.prosecution.weaknesses ?? [];
  if (weak.length) {
    lines.push({ who: "prosecutor", text: `Maine ${weak.length} weak points nikaale hain. Sabse bade: ${weak.slice(0, 3).map((w) => w.point).join(". ")}.`, show: "weak" });
  }
  t.prosecution.questions.forEach((q, i) => {
    lines.push({ who: "prosecutor", text: q.q, show: `q${i}` });
    if (t.defence?.answers[i]) lines.push({ who: "defence", text: t.defence.answers[i]!, show: `a${i}` });
  });
  if (!t.defence) return lines;
  for (const m of (t.defence.team ?? []).slice(0, 6)) {
    lines.push({ who: "defence", text: `${m.who.split(" (")[0]} ki taraf se: ${m.do}${m.dont ? `. Lekin ${m.dont} nahi.` : ""}`, show: "team" });
  }
  lines.push({ who: "defence", text: t.defence.closing, show: "none" });
  if (!t.jury || !t.ruling || !t.verdict) return lines;
  const n = tally(t.jury);
  lines.push({ who: "judge", text: `The jury has voted: ${n.build} build, ${n.fix} fix, ${n.kill} kill.`, show: "jury" });
  lines.push({ who: "judge", text: `${VERDICT_LABEL[t.verdict]}. ${t.ruling.summary}`, show: "verdict" });
  if (t.ruling.fix) lines.push({ who: "judge", text: `What to fix: ${t.ruling.fix}`, show: "verdict" });
  const ups = t.ruling.upgrades ?? [];
  if (ups.length) lines.push({ who: "judge", text: `Har weak point ka upgrade — kul ${ups.length}. ${ups.slice(0, 3).map((u) => u.upgrade).join(". ")}.`, show: "verdict" });
  lines.push({ who: "judge", text: `Your next test: ${t.ruling.next_test}`, show: "verdict" });
  if (t.ruling.failure_risk) lines.push({ who: "judge", text: `${RISK_LABEL[t.ruling.failure_risk]}. ${t.ruling.risk_reason ?? ""}${t.ruling.stop_if ? ` Ruk jaana agar: ${t.ruling.stop_if}` : ""}`, show: "verdict" });
  lines.push({ who: "judge", text: t.ruling.vision, show: "verdict" });
  return lines;
}

function Person({ who, active, size = 64 }: { who: Who; active: boolean; size?: number }) {
  const c = CAST[who];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={`transition-transform duration-300 ${active ? "scale-110" : ""}`}>
      <circle cx="32" cy="22" r="11" fill="#8d5a3b" />
      <path d="M32 11c-7 0-11 4-11 9 3-4 7-5 11-5s8 1 11 5c0-5-4-9-11-9z" fill="#2b1b12" />
      <path d="M12 62c1-15 9-24 20-24s19 9 20 24z" fill={c.color} />
      {who === "judge" && <path d="M22 40h20l-3 22H25z" fill="#111827" opacity=".9" />}
      {active && <circle cx="32" cy="32" r="30" fill="none" stroke={c.color} strokeWidth="2" opacity=".6" />}
    </svg>
  );
}

export function CourtRoom({ initial, canRun }: { initial: Trial; canRun: boolean }) {
  const [trial, setTrial] = useState(initial);
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(trial.error);
  const [voiceTip, setVoiceTip] = useState(false);
  const cancelRef = useRef<() => void>(() => {});
  const lines = useMemo(() => script(trial), [trial]);
  const current = step >= 0 ? lines[step] : undefined;

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const check = () => setVoiceTip(!hasNaturalVoice());
    check();
    window.speechSynthesis.addEventListener?.("voiceschanged", check);
    return () => { window.speechSynthesis.removeEventListener?.("voiceschanged", check); window.speechSynthesis.cancel(); };
  }, []);

  const [waiting, setWaiting] = useState(false);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const stageRef = useRef(trial.stage);
  stageRef.current = trial.stage;

  // Fetch the next stage of the trial in the background, before the script runs out.
  useEffect(() => {
    // Prepare the next stage as soon as possible, while the current one is being heard.
    if (!playing || !canRun || loading || trial.stage === "decided" || error) return;
    setLoading(true);
    advanceTrialAction(trial.id)
      .then((r) => { if (r.ok) { setTrial(r.trial); setError(null); } else { setError(r.error); setPlaying(false); } })
      .finally(() => setLoading(false));
  }, [playing, canRun, loading, trial.id, trial.stage, error]);

  // Speak the current line; when it ends, move on (or wait for the next stage to arrive).
  useEffect(() => {
    if (!playing || step < 0) return;
    const line = linesRef.current[step];
    if (!line) return;
    const c = CAST[line.who];
    const s = speakLine(line.text, c.gender, c.slot, muted);
    cancelRef.current = s.cancel;
    let alive = true;
    s.done.then(() => {
      if (!alive) return;
      if (step < linesRef.current.length - 1) setStep(step + 1);
      else if (stageRef.current === "decided") setPlaying(false);
      else setWaiting(true);
    });
    return () => { alive = false; s.cancel(); };
  }, [step, playing, muted]);

  // A new stage arrived while we were waiting at the end of the script: continue.
  useEffect(() => {
    if (waiting && playing && step < lines.length - 1) { setWaiting(false); setStep(step + 1); }
  }, [waiting, playing, step, lines.length]);

  const start = () => { setError(null); setWaiting(false); setStep((s) => (s < 0 || s >= lines.length - 1 ? 0 : s)); setPlaying(true); };
  const stop = () => { setPlaying(false); cancelRef.current(); };
  const shown = new Set(lines.slice(0, step + 1).map((l) => l.show));
  const revealAll = !playing && step < 0 && trial.stage === "decided";
  const see = (k: Line["show"]) => revealAll || shown.has(k);
  const speaking = current?.who;
  const votes = trial.jury ?? [];
  const n = tally(votes);

  return (
    <div className="overflow-hidden rounded-2xl border border-black/20 shadow-2xl" style={{ background: "linear-gradient(#2dd4bf 0%, #14b8a6 38%, #7c4a21 38%, #5b3416 100%)" }}>
      {/* Courtroom wall: banner with the scales, windows */}
      <div className="relative px-4 pt-4 pb-2">
        <div className="mx-auto flex max-w-md items-center justify-center gap-2 rounded-md bg-[#9f1d2b] px-4 py-2 text-[#fde68a] shadow-lg ring-2 ring-[#fbbf24]/60">
          <Scale className="h-5 w-5" /><span className="font-serif text-sm font-bold tracking-[0.2em] uppercase">Idea Court</span>
        </div>
        <div className="pointer-events-none absolute top-3 left-4 hidden h-20 w-12 rounded-t-full bg-white/40 ring-4 ring-white/50 sm:block" />
        <div className="pointer-events-none absolute top-3 right-4 hidden h-20 w-12 rounded-t-full bg-white/40 ring-4 ring-white/50 sm:block" />
      </div>

      {/* Judge's bench */}
      <div className="flex flex-col items-center">
        <Person who="judge" active={speaking === "judge"} size={72} />
        <div className="-mt-1 rounded-t-md bg-[#8b5a2b] px-6 py-1 text-[11px] font-semibold tracking-widest text-amber-100 uppercase shadow">Justice Nyaya · Judge</div>
      </div>

      <div className="grid grid-cols-[1fr_minmax(0,2fr)_1fr] items-end gap-2 px-3 pt-4 pb-3 sm:gap-4 sm:px-6">
        {/* Prosecution podium */}
        <div className="flex flex-col items-center">
          <Person who="prosecutor" active={speaking === "prosecutor"} />
          <div className="w-full rounded-md bg-[#7f1d1d] py-1 text-center text-[10px] font-bold tracking-widest text-white uppercase">Against</div>
          <p className="mt-1 text-center text-[11px] text-amber-100">Adv. Meera</p>
        </div>

        {/* Exhibit and the case so far */}
        <div className="min-h-56 space-y-2 rounded-lg bg-[#fdf6e3] p-3 text-zinc-800 shadow-inner">
          <p className="text-[10px] font-bold tracking-widest text-[#9f1d2b] uppercase">Exhibit A{trial.proposed_by ? ` · ${trial.proposed_by}` : ""}</p>
          <p className="font-serif text-base leading-snug">{trial.idea}</p>
          {see("weak") && (trial.prosecution?.weaknesses?.length ?? 0) > 0 && (
            <div className="rounded border border-rose-200 bg-white p-2 text-sm">
              <p className="text-[10px] font-bold tracking-widest text-rose-700 uppercase">Weak points{see("verdict") && trial.ruling?.upgrades?.length ? " → upgrades" : ""}</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                {trial.prosecution!.weaknesses!.map((w, i) => {
                  const up = see("verdict") ? trial.ruling?.upgrades?.[i] : undefined;
                  return (
                    <li key={i}>
                      <span className="text-rose-800">{w.point}</span>
                      {up && <span className="block text-emerald-800">↳ {up.upgrade} <span className="text-xs text-zinc-500">[{up.owner}]</span></span>}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          {trial.prosecution?.questions.map((q, i) => see(`q${i}`) && (
            <div key={i} className="rounded border border-rose-200 bg-white p-2 text-sm">
              <p className="font-medium text-rose-700">Q{i + 1}. {q.q}</p>
              {see(`a${i}`) && trial.defence?.answers[i] && <p className="mt-1 border-l-2 border-blue-400 pl-2 text-blue-800">{trial.defence.answers[i]}</p>}
            </div>
          ))}
          {see("team") && (trial.defence?.team?.length ?? 0) > 0 && (
            <div className="rounded border border-blue-200 bg-white p-2 text-sm">
              <p className="text-[10px] font-bold tracking-widest text-blue-800 uppercase">Defence, for the team</p>
              <ul className="mt-1 space-y-1">
                {trial.defence!.team!.map((m, i) => (
                  <li key={i}><span className="font-medium">{m.who}:</span> <span className="text-emerald-800">do {m.do}</span>{m.dont && <span className="text-rose-700"> · don&apos;t {m.dont}</span>}</li>
                ))}
              </ul>
            </div>
          )}
          {see("verdict") && trial.verdict && trial.ruling && (
            <div className="rounded-lg border-2 border-dashed border-zinc-300 bg-white p-3 text-center">
              <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Verdict</p>
              <p className={`mx-auto mt-1 inline-block -rotate-3 rounded-full px-5 py-1 text-xl font-black tracking-wide ring-4 ring-offset-2 ${VOTE_STYLE[trial.verdict]}`}>{VERDICT_LABEL[trial.verdict]}</p>
              <p className="mt-2 text-sm">{trial.ruling.summary}</p>
              {trial.ruling.fix && <p className="mt-2 text-sm"><span className="font-semibold">Fix: </span>{trial.ruling.fix}</p>}
              {trial.ruling.plan?.length ? (
                <ol className="mx-auto mt-2 max-w-md list-decimal pl-5 text-left text-sm">{trial.ruling.plan.map((p, i) => <li key={i}>{p}</li>)}</ol>
              ) : null}
              <p className="mt-1 text-sm"><span className="font-semibold">Next test (7 days, ₹0): </span>{trial.ruling.next_test}</p>
              {trial.ruling.failure_risk && (
                <p className="mt-1 text-sm"><span className={`rounded px-1.5 text-xs font-bold ${trial.ruling.failure_risk === "low" ? "bg-emerald-100 text-emerald-800" : trial.ruling.failure_risk === "medium" ? "bg-amber-100 text-amber-900" : "bg-rose-100 text-rose-800"}`}>{RISK_LABEL[trial.ruling.failure_risk]}</span> {trial.ruling.risk_reason}</p>
              )}
              {trial.ruling.stop_if && <p className="mt-1 text-sm"><span className="font-semibold">Stop if: </span>{trial.ruling.stop_if}</p>}
              <p className="mt-2 font-serif text-base italic text-[#9f1d2b]">“{trial.ruling.vision}”</p>
            </div>
          )}
        </div>

        {/* Defence podium */}
        <div className="flex flex-col items-center">
          <Person who="defence" active={speaking === "defence"} />
          <div className="w-full rounded-md bg-[#1e3a8a] py-1 text-center text-[10px] font-bold tracking-widest text-white uppercase">For</div>
          <p className="mt-1 text-center text-[11px] text-amber-100">Adv. Arjun</p>
        </div>
      </div>

      {/* Jury box */}
      <div className="mx-3 mb-3 rounded-lg bg-[#4a2a10]/80 p-2 sm:mx-6">
        <p className="mb-1.5 text-center text-[10px] font-bold tracking-widest text-amber-200 uppercase">12 AI jurors{see("jury") && votes.length ? ` · ${n.build} build · ${n.fix} fix · ${n.kill} kill` : ""}</p>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
          {JURY.map((j) => {
            const v = see("jury") ? votes.find((x) => x.juror === j.key) : undefined;
            return (
              <div key={j.key} title={v?.reason} className="flex flex-col items-center rounded bg-[#6b3d16] px-1 py-1.5">
                <span className={`mb-1 rounded px-1.5 text-[9px] font-bold uppercase transition ${v ? VOTE_STYLE[v.vote as Vote] : "bg-black/30 text-amber-200/50"}`}>{v ? v.vote : "?"}</span>
                <span className="text-center text-[9px] leading-tight text-amber-100">{j.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Captions + controls */}
      <div className="bg-black/80 px-4 py-3 text-zinc-100">
        <p className="min-h-10 text-center text-sm leading-relaxed">
          {current ? <><span className="font-semibold" style={{ color: CAST[current.who].color === "#b45309" ? "#fbbf24" : CAST[current.who].color }}>{CAST[current.who].name}: </span>{current.text}</>
            : loading ? <span className="text-zinc-400">The court is preparing…</span>
              : trial.stage === "decided" ? <span className="text-zinc-400">The case is closed. Press play to hear it again.</span>
                : <span className="text-zinc-400">Press play to begin the trial.</span>}
        </p>
        {loading && current && <p className="text-center text-[11px] text-zinc-500">The next side is preparing…</p>}
        {error && <p className="mt-1 text-center text-xs text-rose-300">{error}</p>}
        <div className="mt-2 flex items-center justify-center gap-2">
          {playing ? (
            <button type="button" onClick={stop} className="flex h-10 items-center gap-2 rounded-full bg-zinc-800 px-4 text-sm hover:bg-zinc-700"><Gavel className="h-4 w-4" />Pause</button>
          ) : (
            <button type="button" onClick={start} disabled={!canRun && trial.stage !== "decided"} className="flex h-10 items-center gap-2 rounded-full bg-amber-400 px-5 text-sm font-semibold text-zinc-900 hover:bg-amber-300 disabled:opacity-40">
              {step >= 0 ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}{trial.stage === "decided" ? "Play the trial" : step >= 0 ? "Continue" : "Begin trial"}
            </button>
          )}
          <button type="button" onClick={() => setMuted((m) => !m)} className="grid h-10 w-10 place-items-center rounded-full bg-zinc-800 hover:bg-zinc-700" title={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
        {voiceTip && <p className="mt-2 text-center text-[11px] text-zinc-500">Tip: open in Microsoft Edge for natural Indian voices (Neerja, Prabhat, Swara, Madhur) — free.</p>}
      </div>
    </div>
  );
}
