"use client";

import { Square, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";

/** One spoken part: the text and which board voice reads it (0 = CEO, 1 = COO, 2 = CFO, 3 = Legal Head). */
export interface SpeechPart { text: string; voice?: number }

/** Each board member sounds different: a different system voice when available, plus pitch and pace. */
const PERSONA = [
  { pitch: 0.85, rate: 0.95 }, // CEO — calm, deep
  { pitch: 1.05, rate: 1.08 }, // COO — brisk
  { pitch: 0.95, rate: 0.98 }, // CFO — measured
  { pitch: 1.2, rate: 0.95 },  // Legal Head — clear, higher
] as const;

function pickVoices(synth: SpeechSynthesis): SpeechSynthesisVoice[] {
  const all = synth.getVoices();
  const indian = all.filter((v) => v.lang === "en-IN" || v.lang.startsWith("hi"));
  const english = all.filter((v) => v.lang.startsWith("en") && !indian.includes(v));
  return [...indian, ...english];
}

/** Reads text aloud with the browser's built-in voices (free, no account needed). */
export function ListenButton({ parts, label = "Listen" }: { parts: SpeechPart[]; label?: string }) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setSupported(true);
    window.speechSynthesis.getVoices(); // Chrome loads voices lazily
  }, []);
  if (!supported || !parts.length) return null;

  const speak = () => {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (speaking) { setSpeaking(false); return; }
    const voices = pickVoices(synth);
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p.text.replace(/[*#_`>]/g, ""));
      const slot = Math.abs(p.voice ?? 0) % PERSONA.length;
      const voice = voices.length ? voices[slot % voices.length] : undefined;
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.pitch = PERSONA[slot]!.pitch;
      u.rate = PERSONA[slot]!.rate;
      if (i === parts.length - 1) { u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false); }
      synth.speak(u);
    });
    setSpeaking(true);
  };

  return (
    <button type="button" onClick={speak} className="btn-ghost px-2.5 py-1 text-xs" aria-pressed={speaking}>
      {speaking ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Volume2 className="h-3.5 w-3.5" aria-hidden />}
      {speaking ? "Stop" : label}
    </button>
  );
}
