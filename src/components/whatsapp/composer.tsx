"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Sparkles } from "lucide-react";
import { draftReplyAction, sendMessageAction } from "@/modules/whatsapp/actions";

const CARE_LABEL: Record<string, string> = { price: "price", money: "payment", legal: "legal/tax", promise: "a date or promise" };

/** Iris drafts, the Founder edits and presses Send. Nothing goes out without that press. */
export function Composer({ chatId, canSend, disabled }: { chatId: string; canSend: boolean; disabled: string | null }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [draftedBy, setDraftedBy] = useState<string | null>(null);
  const [care, setCare] = useState<string[]>([]);
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  // New messages arrive while the chat is open: refresh quietly (only when not typing).
  useEffect(() => {
    const t = setInterval(() => { if (!busy && !text) router.refresh(); }, 15_000);
    return () => clearInterval(t);
  }, [router, busy, text]);

  const draft = async () => {
    setBusy("draft"); setNote(null);
    const r = await draftReplyAction(chatId);
    setBusy(null);
    if (!r.ok) { setNote({ ok: false, text: r.error }); return; }
    setText(r.draft); setDraftedBy(r.agentId); setCare(r.care);
    setNote({ ok: true, text: `${r.agentName} wrote this — read it, change anything, then send.` });
  };
  const send = async () => {
    setBusy("send"); setNote(null);
    const r = await sendMessageAction(chatId, text, draftedBy);
    setBusy(null);
    if (!r.ok) { setNote({ ok: false, text: r.error }); return; }
    setText(""); setDraftedBy(null); setCare([]); setNote({ ok: true, text: r.message });
    router.refresh();
  };

  if (disabled) return <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{disabled}</p>;

  return (
    <div className="space-y-2">
      <textarea value={text} onChange={(e) => { setText(e.target.value); if (!e.target.value) setDraftedBy(null); }} rows={4} maxLength={1500}
        placeholder="Type a message, or let Iris draft it…" className="input min-h-24 w-full resize-y" aria-label="Message" />
      {care.length > 0 && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
          Check before sending: this mentions {care.map((c) => CARE_LABEL[c] ?? c).join(", ")}. Make sure it matches what you really offer.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={draft} disabled={!!busy} className="btn-ghost"><Sparkles className="h-4 w-4" />{busy === "draft" ? "Iris is writing…" : "Draft with Iris"}</button>
        {canSend
          ? <button type="button" onClick={send} disabled={!!busy || !text.trim()} className="btn-gold"><Send className="h-4 w-4" />{busy === "send" ? "Sending…" : "Send on WhatsApp"}</button>
          : <span className="text-xs text-zinc-500">Only the Founder or an admin can send.</span>}
        <span className="ml-auto text-[11px] text-zinc-500">{text.length}/1500</span>
      </div>
      {note && <p className={`text-xs ${note.ok ? "text-emerald-300" : "text-rose-300"}`}>{note.text}</p>}
    </div>
  );
}
