"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, Mic, MicOff, MessageSquare, PhoneOff, Play, Send, Volume2, VolumeX } from "lucide-react";
import { endMeetingAction, memberTurnAction, sayAction } from "@/modules/board/actions";
import type { BoardMessage } from "@/types/domain";

export interface RoomSeat { agentId: string; name: string; title: string; color: string; voice: number }

/** Each person sounds different: a different system voice where available, plus pitch and pace. */
const PERSONA = [
  { pitch: 0.85, rate: 1.0 }, { pitch: 1.05, rate: 1.1 }, { pitch: 0.95, rate: 1.02 }, { pitch: 1.2, rate: 1.0 },
  { pitch: 1.1, rate: 1.05 }, { pitch: 0.9, rate: 1.08 }, { pitch: 1.15, rate: 0.98 },
] as const;

function voicesFor(synth: SpeechSynthesis): SpeechSynthesisVoice[] {
  const all = synth.getVoices();
  const indian = all.filter((v) => v.lang === "en-IN" || v.lang.startsWith("hi"));
  return [...indian, ...all.filter((v) => v.lang.startsWith("en") && !indian.includes(v))];
}

const plain = (t: string) => t.replace(/[*#_`>]/g, "").replace(/\s+/g, " ").trim();

/** A glowing silhouette, in the member's colour; it pulses while they speak. */
function Avatar({ color, speaking }: { color: string; speaking: boolean }) {
  const id = color.replace(/[^a-z0-9]/gi, "");
  return (
    <svg viewBox="0 0 120 120" className={`h-full max-h-36 w-auto transition-transform duration-300 ${speaking ? "scale-105" : ""}`} aria-hidden>
      <defs>
        <radialGradient id={`g-${id}`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="35%" stopColor={color} stopOpacity="0.95" />
          <stop offset="100%" stopColor={color} stopOpacity="0.25" />
        </radialGradient>
        <filter id={`f-${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={speaking ? 6 : 3.5} result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g filter={`url(#f-${id})`} fill={`url(#g-${id})`}>
        <circle cx="60" cy="40" r="19" />
        <path d="M22 112c2-26 18-42 38-42s36 16 38 42z" />
      </g>
    </svg>
  );
}

function Tile({ name, title, color, speaking, children, badge }: { name: string; title: string; color: string; speaking: boolean; children?: ReactNode; badge?: ReactNode }) {
  return (
    <div
      className="relative flex aspect-video min-h-28 items-center justify-center overflow-hidden rounded-xl bg-[#0b0d12] transition-shadow duration-300"
      style={{ boxShadow: speaking ? `0 0 0 3px ${color}, 0 0 40px -6px ${color}` : `inset 0 0 0 1px rgb(255 255 255 / 0.06)`, backgroundImage: `radial-gradient(ellipse at 50% 120%, ${color}22, transparent 60%)` }}
    >
      {children}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-0.5 text-xs text-zinc-100 backdrop-blur">
        {speaking && <span className="flex h-3 items-end gap-0.5" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="w-0.5 animate-pulse rounded bg-current" style={{ height: `${6 + i * 3}px`, animationDelay: `${i * 120}ms` }} />)}</span>}
        <span className="font-medium">{name}</span><span className="text-zinc-400">{title}</span>
      </div>
      {badge && <div className="absolute top-2 right-2">{badge}</div>}
    </div>
  );
}

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

export function MeetingRoom({ meetingId, topic, seats, founder, scribeName, initial, live, canSpeak }: {
  meetingId: string; topic: string; seats: RoomSeat[]; founder: string; scribeName: string | null; initial: BoardMessage[]; live: boolean; canSpeak: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<BoardMessage[]>(initial);
  const [queue, setQueue] = useState<BoardMessage[]>([]);
  const [current, setCurrent] = useState<BoardMessage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const seatOf = useCallback((id: string | null) => seats.find((s) => s.agentId === id), [seats]);

  const receive = useCallback((incoming: BoardMessage[]) => {
    if (!incoming.length) return;
    setMessages((m) => [...m, ...incoming.filter((x) => !m.some((y) => y.id === x.id))]);
    setQueue((q) => [...q, ...incoming.filter((x) => x.role !== "founder" && !x.failed)]);
  }, []);

  // Nobody speaks until the Founder starts the meeting (Start button, or simply saying something).
  const [started, setStarted] = useState(() => initial.some((m) => m.role === "member" && !m.failed) || initial.some((m) => m.role === "founder"));
  const [thinking, setThinking] = useState<Set<string>>(new Set());

  /** Runs members' turns in parallel; each voice starts as soon as that member is ready. */
  const runTurns = useCallback(async (mode: "open" | "reply", ids: string[]) => {
    setThinking(new Set(ids));
    let silent = 0;
    await Promise.all(ids.map(async (id) => {
      const r = await memberTurnAction(meetingId, id, mode);
      setThinking((t) => { const n = new Set(t); n.delete(id); return n; });
      if (!r.ok) { setError(r.error); return; }
      if (r.message) receive([r.message]); else silent++;
    }));
    if (mode === "reply" && ids.length && silent === ids.length) setError("Nobody answered — try asking someone by name, e.g. “Ledger, …”.");
  }, [meetingId, receive]);

  const startMeeting = async () => {
    if (busy || !seats.length) return;
    setStarted(true);
    setError(null);
    setBusy("open");
    const [chair, ...rest] = seats;
    await runTurns("open", [chair!.agentId]); // the chair opens…
    await runTurns("open", rest.map((s) => s.agentId)); // …then everyone responds, whoever is ready first speaks first
    setBusy(null);
  };

  // Take the next line from the queue…
  useEffect(() => {
    if (current || !queue.length) return;
    setCurrent(queue[0]!);
    setQueue((q) => q.slice(1));
  }, [queue, current]);

  // …and speak it: highlight the speaker's tile and show captions until they finish.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  useEffect(() => {
    if (!current) return;
    const body = plain(current.body);
    let finished = false;
    const done = () => { if (!finished) { finished = true; setCurrent(null); } };
    const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
    if (mutedRef.current || !synth) {
      const t = setTimeout(done, Math.min(12_000, Math.max(2_500, body.length * 45)));
      return () => clearTimeout(t);
    }
    const u = new SpeechSynthesisUtterance(body);
    const seat = seatOf(current.agent_id);
    const slot = current.role === "scribe" ? 4 : (seat?.voice ?? 0) % PERSONA.length;
    const voices = voicesFor(synth);
    if (voices.length) { const v = voices[slot % voices.length]!; u.voice = v; u.lang = v.lang; }
    u.pitch = PERSONA[slot]!.pitch;
    u.rate = PERSONA[slot]!.rate;
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
    // Safety net: some browsers never fire onend for long texts.
    const guard = setTimeout(done, Math.max(20_000, body.length * 120));
    return () => clearTimeout(guard);
  }, [current, seatOf]);

  useEffect(() => () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); }, []);

  const send = async (said: string) => {
    const msg = said.trim();
    if (!msg) return;
    // "Stop / ruko" just silences the room — no need to ask anyone anything.
    if (/^(stop|ruko|ruk jao|chup|wait|bas|hold on)[.! ]*$/i.test(msg)) {
      setText("");
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      setQueue([]);
      setCurrent(null);
      return;
    }
    if (busy) return;
    setText("");
    setError(null);
    setStarted(true);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setQueue([]);
    setCurrent(null);
    setBusy("reply");
    const r = await sayAction(meetingId, msg);
    if (!r.ok) { setBusy(null); setError(r.error); return; }
    setMessages((m) => [...m, r.message]);
    // Like a real meeting: the person whose question it is answers; others only chime in if it matters (small talk: just the chair).
    await runTurns("reply", [...r.addressed, ...r.others]);
    setBusy(null);
  };

  const toggleMic = () => {
    if (listening) { recRef.current?.stop(); return; }
    const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Rec = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Rec) { setError("Voice input works in Chrome or Edge. You can type instead."); return; }
    const rec = new Rec();
    rec.lang = "en-IN"; // understands Indian English and Hinglish
    rec.interimResults = true;
    rec.continuous = false;
    let said = "";
    rec.onresult = (e) => { said = Array.from(e.results).map((r) => r[0]?.transcript ?? "").join(" "); setText(said); };
    rec.onend = () => { setListening(false); if (said.trim()) void send(said); };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const end = async () => {
    if (busy) return;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setQueue([]);
    setCurrent(null);
    setBusy("minutes");
    const r = await endMeetingAction(meetingId);
    setBusy(null);
    if (r.ok) router.refresh(); else setError(r.error ?? "Could not end the meeting");
  };

  const thinkingNames = seats.filter((s) => thinking.has(s.agentId)).map((s) => s.name);
  const busyText = busy === "minutes" ? `${scribeName ?? "The secretary"} is writing the minutes…`
    : thinkingNames.length ? `${thinkingNames.join(", ")} ${thinkingNames.length > 1 ? "are" : "is"} thinking…` : busy ? "…" : null;
  const speakingId = current?.role === "scribe" ? "scribe" : current?.agent_id ?? null;
  const caption = current ? { who: current.speaker.split(" · ")[0], text: plain(current.body) } : null;

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[560px] flex-col overflow-hidden rounded-2xl border border-white/5 bg-[#06070a] text-zinc-100 shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{topic}</p>
          <p className="text-xs text-zinc-500">{live ? `${seats.length + (scribeName ? 2 : 1)} in the meeting` : "Meeting ended"}</p>
        </div>
        {live && <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-medium text-rose-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />LIVE</span>}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1 overflow-y-auto p-3" style={{ backgroundImage: "radial-gradient(ellipse at top, rgb(30 41 59 / 0.35), transparent 60%)" }}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {seats.map((s) => (
              <Tile key={s.agentId} name={s.name} title={s.title} color={s.color} speaking={speakingId === s.agentId}
                badge={thinking.has(s.agentId) ? <span className="flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-zinc-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: s.color }} />thinking</span> : undefined}>
                <Avatar color={s.color} speaking={speakingId === s.agentId} />
              </Tile>
            ))}
            {scribeName && (
              <Tile name={scribeName} title="Notes" color="#e5e7eb" speaking={speakingId === "scribe"} badge={<span className="flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-zinc-300"><FileText className="h-3 w-3" />{live ? "taking notes" : "minutes ready"}</span>}>
                <Avatar color="#e5e7eb" speaking={speakingId === "scribe"} />
              </Tile>
            )}
            <Tile name={founder} title="You" color="#fbbf24" speaking={listening}>
              <div className="grid h-16 w-16 place-items-center rounded-full bg-amber-400/15 text-2xl font-semibold text-amber-200">{founder.slice(0, 1)}</div>
            </Tile>
          </div>

          {live && canSpeak && !started && (
            <div className="mt-6 flex flex-col items-center gap-3 text-center">
              <p className="max-w-md text-sm text-zinc-400">Sab aa gaye hain aur aapka intezaar kar rahe hain. Bolo (🎤) ya likho — ya {seats[0]?.name ?? "the chair"} ko meeting shuru karne do.</p>
              <button type="button" onClick={startMeeting} className="flex h-11 items-center gap-2 rounded-full bg-zinc-100 px-5 text-sm font-medium text-zinc-900 hover:bg-white"><Play className="h-4 w-4" />Start — {seats[0]?.name ?? "chair"} opens</button>
            </div>
          )}

          {(caption || busyText) && (
            <div className="pointer-events-none sticky bottom-0 mt-4 flex justify-center">
              <p className="max-w-3xl rounded-lg bg-black/75 px-4 py-2 text-center text-sm leading-relaxed text-zinc-100 backdrop-blur">
                {caption ? <><span className="font-semibold" style={{ color: seatOf(current!.agent_id)?.color ?? "#e5e7eb" }}>{caption.who}: </span>{caption.text.length > 420 ? `${caption.text.slice(0, 420)}…` : caption.text}</> : <span className="text-zinc-400">{busyText}</span>}
              </p>
            </div>
          )}
        </div>

        {showChat && (
          <aside className="hidden w-80 shrink-0 flex-col border-l border-white/5 md:flex">
            <p className="border-b border-white/5 px-4 py-2.5 text-xs font-medium text-zinc-400">Transcript</p>
            <ol className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
              {messages.map((m) => (
                <li key={m.id}>
                  <p className="text-xs font-medium" style={{ color: m.role === "founder" ? "#fbbf24" : m.role === "scribe" ? "#e5e7eb" : seatOf(m.agent_id)?.color }}>{m.speaker}</p>
                  <p className={`mt-0.5 whitespace-pre-wrap ${m.failed ? "text-amber-300" : "text-zinc-300"}`}>{m.body}</p>
                </li>
              ))}
            </ol>
          </aside>
        )}
      </div>

      {error && <p className="border-t border-rose-500/20 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 border-t border-white/5 px-3 py-3">
        {live && canSpeak ? (
          <>
            <button type="button" onClick={toggleMic} disabled={!!busy} title={listening ? "Stop" : "Speak"} className={`grid h-11 w-11 place-items-center rounded-full transition ${listening ? "bg-rose-500 text-white" : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"}`}>
              {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
            <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="flex min-w-0 flex-1 items-center gap-2">
              <input value={text} onChange={(e) => setText(e.target.value)} disabled={!!busy} maxLength={2000} placeholder={listening ? "Listening…" : "Ask the board, or address someone: “Ledger, price kya rakhein?”"} className="h-11 min-w-0 flex-1 rounded-full border border-white/10 bg-zinc-900 px-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-white/25 focus:outline-none" />
              <button type="submit" disabled={!!busy || !text.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-900 disabled:opacity-40" title="Send"><Send className="h-4 w-4" /></button>
            </form>
          </>
        ) : <p className="flex-1 text-sm text-zinc-500">{live ? "View only" : "This meeting has ended — the minutes are below."}</p>}
        <button type="button" onClick={() => { setMuted((m) => !m); if (!muted && "speechSynthesis" in window) window.speechSynthesis.cancel(); }} title={muted ? "Unmute" : "Mute voices"} className="grid h-11 w-11 place-items-center rounded-full bg-zinc-800 text-zinc-100 hover:bg-zinc-700">
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
        <button type="button" onClick={() => setShowChat((c) => !c)} title="Transcript" className={`hidden h-11 w-11 place-items-center rounded-full md:grid ${showChat ? "bg-sky-500/20 text-sky-200" : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"}`}>
          <MessageSquare className="h-5 w-5" />
        </button>
        {live && canSpeak && (
          <button type="button" onClick={end} disabled={!!busy} className="flex h-11 items-center gap-2 rounded-full bg-rose-600 px-4 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50">
            <PhoneOff className="h-4 w-4" />End &amp; minutes
          </button>
        )}
      </div>
    </div>
  );
}
