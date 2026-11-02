/**
 * Human-sounding Indian voices, free: browsers ship neural voices (Edge: "Microsoft Neerja / Prabhat / Swara / Madhur
 * Online (Natural)", Chrome: "Google हिन्दी", "Google UK English …"). Pitch tricks make voices robotic, so each person
 * gets a different real voice at natural pitch instead — men and women where the browser has both.
 */
export type VoiceGender = "male" | "female";

const FEMALE = /neerja|swara|aria|jenny|sonia|libby|natasha|heera|kalpana|zira|samantha|karen|moira|tessa|veena|ananya|aarohi|female|woman|google हिन्दी|google uk english female/i;
const MALE = /prabhat|madhur|ravi|hemant|guy|ryan|thomas|william|davis|daniel|rishi|kunal|aarav|\bmale\b|\bman\b|google uk english male/i;

function rankVoice(v: SpeechSynthesisVoice): number {
  let score = 0;
  if (/natural|neural|online|premium|enhanced/i.test(v.name)) score += 100;
  else if (/^google/i.test(v.name)) score += 60;
  if (v.lang === "en-IN") score += 30;
  else if (v.lang.startsWith("hi")) score += 25;
  else if (v.lang.startsWith("en")) score += 10;
  else score -= 100;
  return score;
}

/** Best voice for a speaker: Indian and natural first, their gender if available, a different voice per slot. */
export function pickVoice(voices: SpeechSynthesisVoice[], gender: VoiceGender, slot: number): SpeechSynthesisVoice | undefined {
  const usable = voices.filter((v) => rankVoice(v) > 0).sort((a, b) => rankVoice(b) - rankVoice(a));
  const matching = usable.filter((v) => (gender === "female" ? FEMALE.test(v.name) : MALE.test(v.name) && !FEMALE.test(v.name)));
  const pool = matching.length ? matching : usable;
  return pool.length ? pool[Math.max(0, slot) % pool.length] : undefined;
}

/** True when the browser offers a neural (human-like) voice — used to suggest Edge otherwise. */
export function hasNaturalVoice(): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  return window.speechSynthesis.getVoices().some((v) => /natural|neural|online/i.test(v.name) && (v.lang === "en-IN" || v.lang.startsWith("hi")));
}

export const plainSpeech = (t: string) => t.replace(/[*#_`>]/g, "").replace(/\s+/g, " ").trim();

/** Speaks one line and resolves when it ends (or after a safety timeout; or immediately when muted). */
export function speakLine(text: string, gender: VoiceGender, slot: number, muted: boolean): { done: Promise<void>; cancel: () => void } {
  const body = plainSpeech(text);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
  if (muted || !synth) {
    timer = setTimeout(finish, Math.min(9_000, Math.max(2_200, body.length * 45)));
    return { done, cancel: () => { clearTimeout(timer); finish(); } };
  }
  const u = new SpeechSynthesisUtterance(body);
  const v = pickVoice(synth.getVoices(), gender, slot);
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = 1.04;
  u.onend = () => { clearTimeout(timer); finish(); };
  u.onerror = () => { clearTimeout(timer); finish(); };
  timer = setTimeout(finish, Math.max(20_000, body.length * 120)); // some browsers never fire onend
  synth.speak(u);
  return { done, cancel: () => { clearTimeout(timer); synth.cancel(); finish(); } };
}
