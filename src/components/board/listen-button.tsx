"use client";

import { Square, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";

/** Reads text aloud with the browser's built-in voice (free, works offline). Prefers an Indian English or Hindi voice. */
export function ListenButton({ text, label = "Listen" }: { text: string; label?: string }) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(typeof window !== "undefined" && "speechSynthesis" in window), []);
  useEffect(() => () => { if (speaking) window.speechSynthesis.cancel(); }, [speaking]);
  if (!supported) return null;

  const speak = () => {
    const synth = window.speechSynthesis;
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*#_`>]/g, ""));
    const voices = synth.getVoices();
    const voice = voices.find((v) => v.lang === "en-IN") ?? voices.find((v) => v.lang.startsWith("hi")) ?? voices.find((v) => v.lang.startsWith("en"));
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.rate = 1;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  };

  return (
    <button type="button" onClick={speak} className="btn-ghost px-2.5 py-1 text-xs" aria-pressed={speaking}>
      {speaking ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Volume2 className="h-3.5 w-3.5" aria-hidden />}
      {speaking ? "Stop" : label}
    </button>
  );
}
