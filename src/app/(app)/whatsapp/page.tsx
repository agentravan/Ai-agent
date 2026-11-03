import Link from "next/link";
import { MessageCircle, Phone, ShieldCheck, Smartphone } from "lucide-react";
import { Badge, Card, Empty, Flash, PageHeader, type SearchParams } from "@/components/ui";
import { AutoRefresh } from "@/components/whatsapp/auto-refresh";
import { Composer } from "@/components/whatsapp/composer";
import { SubmitButton } from "@/components/ui/submit-button";
import { can } from "@/lib/permissions";
import { requireContext } from "@/modules/auth/session";
import { openNumberAction } from "@/modules/whatsapp/actions";
import { phoneOf } from "@/modules/whatsapp/logic";
import { deskState, openChat, type DeskState } from "@/modules/whatsapp/service";

export const metadata = { title: "WhatsApp Desk" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const time = (unix: number | null) => (unix ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(unix * 1000)) : "");

function Connection({ s }: { s: DeskState }) {
  if (!s.configured) {
    return (
      <>
      <Card title="Use it from your phone right now" description="No gateway, no laptop, ₹0 — works today." className="mb-4">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-zinc-300">
          <li>A client messages you on WhatsApp → copy their message.</li>
          <li>Open <b>My Desk → WhatsApp reply assistant</b>, paste it (add their number if they&apos;re new).</li>
          <li>Iris writes the reply and updates the lead → tap <b>Send on WhatsApp</b> → WhatsApp opens with the reply filled in → Send.</li>
        </ol>
        <Link href="/desk#whatsapp" className="btn-gold mt-3 inline-flex"><MessageCircle className="h-4 w-4" />Open the WhatsApp reply assistant</Link>
      </Card>
      <Card title="Later: fully automatic chats (optional)" description="Free, no Meta setup — your own number, logged in by QR like WhatsApp Web.">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-zinc-300">
          <li>Easiest, ₹0: run the phone gateway in <b>Termux</b> on your own phone (no card, no laptop) — or a WAHA server. Guide: <code>docs/WHATSAPP_SETUP.md</code>.</li>
          <li>Add <code>WHATSAPP_WEBHOOK_SECRET</code> in Vercel (phone gateway) — or <code>WAHA_URL</code> + <code>WAHA_API_KEY</code> for a WAHA server — then redeploy.</li>
          <li>Link WhatsApp: the code shown here (phone gateway) or the QR (WAHA) → WhatsApp → Linked devices.</li>
        </ol>
        <p className="mt-3 text-xs text-amber-300">This uses WhatsApp Web, not Meta&apos;s official API. Keep it to real conversations (the desk caps new contacts per day) so WhatsApp doesn&apos;t restrict the number.</p>
      </Card>
      </>
    );
  }
  if (s.mode === "phone") {
    if (s.status === "PAIRING" && s.pairingCode) {
      return (
        <Card title="Link your WhatsApp" description="On the business phone: WhatsApp → ⋮ → Linked devices → Link a device → Link with phone number instead → enter this code.">
          <p className="text-center font-mono text-4xl font-bold tracking-[0.3em] text-emerald-300">{s.pairingCode}</p>
          <AutoRefresh seconds={8} />
        </Card>
      );
    }
    if (s.status === "OFFLINE" || s.status === "LOGGED_OUT" || s.status === "STARTING") {
      const title = s.status === "LOGGED_OUT" ? "WhatsApp was unlinked" : s.status === "STARTING" ? "Phone gateway is connecting…" : "Your phone gateway is offline";
      const hint = s.status === "LOGGED_OUT" ? "Open Termux and run the gateway again — it will show a new code to link."
        : s.status === "STARTING" ? "This page refreshes by itself."
          : `Open Termux on the phone (keep it running, internet on). ${s.lastSeen ? `Last seen ${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(s.lastSeen))}.` : "It has not connected yet — see docs/WHATSAPP_SETUP.md (phone gateway)."} Replies wait in the queue and go out when it's back.`;
      return <Card title={title} className="mb-4"><p className="text-sm text-amber-200">{hint}</p><AutoRefresh seconds={20} /></Card>;
    }
    return null;
  }
  if (s.status === "UNREACHABLE") return <Card title="WhatsApp gateway offline"><p className="text-sm text-rose-300">{s.error}</p><AutoRefresh seconds={30} /></Card>;
  if (s.status === "SCAN_QR_CODE") {
    return (
      <Card title="Scan to connect" description="WhatsApp Business → ⋮ → Linked devices → Link a device. The code refreshes by itself.">
        {s.qr ? <img src={s.qr} alt="WhatsApp login QR code" className="mx-auto h-64 w-64 rounded-lg bg-white p-2" /> : <p className="text-sm text-zinc-400">Preparing the code…</p>}
        <AutoRefresh seconds={8} />
      </Card>
    );
  }
  if (s.status !== "WORKING") return <Card title="WhatsApp is starting…"><p className="text-sm text-zinc-400">Status: {s.status.toLowerCase().replace(/_/g, " ")}. This page refreshes by itself.</p><AutoRefresh seconds={8} /></Card>;
  return null;
}

export default async function WhatsappPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const params = await searchParams;
  const s = await deskState(ctx);
  const selected = typeof params.chat === "string" && /^\d{8,15}@(c\.us|s\.whatsapp\.net)$/.test(params.chat) ? params.chat : null;
  const chat = selected && (s.status === "WORKING" || s.mode === "phone") ? await openChat(ctx, selected) : null;
  const current = selected ? s.chats.find((c) => c.id === selected) : undefined;
  const canOperate = can(ctx.profile.role, "operate");
  const canSend = can(ctx.profile.role, "govern");

  return (
    <>
      <PageHeader eyebrow="Operations · Client chat" title="WhatsApp Desk"
        subtitle="Your team answers clients on your own WhatsApp number. Iris drafts every reply; nothing is sent until you press Send."
        action={s.status === "WORKING" ? <Badge tone="good">{`Connected${s.me ? ` · +${s.me}` : ""}${s.mode === "phone" ? " · phone" : ""}`}</Badge> : undefined} />
      <Flash params={params} />
      <Connection s={s} />

      {(s.status === "WORKING" || s.mode === "phone") && (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <Card title="Chats" description={`New people today: ${s.newToday}/${s.dailyNewLimit}`} flush>
            {canOperate && (
              <form action={openNumberAction} className="flex gap-2 border-b border-line p-3">
                <input name="phone" inputMode="tel" maxLength={20} placeholder="New number, e.g. 98765 43210" className="input h-9 flex-1 text-sm" aria-label="Phone number" />
                <SubmitButton variant="ghost"><Phone className="h-4 w-4" />Open</SubmitButton>
              </form>
            )}
            {s.chats.length ? (
              <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto">
                {s.chats.map((c) => (
                  <li key={c.id}>
                    <Link href={`/whatsapp?chat=${encodeURIComponent(c.id)}`} className={`block px-3 py-2.5 hover:bg-panel-2/60 ${c.id === selected ? "bg-panel-2/80" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-zinc-100">{c.leadName ?? c.name ?? phoneOf(c.id)}</span>
                        <span className="shrink-0 text-[10px] text-zinc-500">{time(c.lastAt)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="truncate text-xs text-zinc-400">{c.lastFromMe ? "You: " : ""}{c.lastText ?? ""}</span>
                        {c.unread > 0 && <span className="ml-auto rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-black">{c.unread}</span>}
                        {c.optedOut && <span className="ml-auto text-[10px] text-rose-300">opted out</span>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <div className="p-4"><Empty icon={MessageCircle}>No chats yet. When clients message you, they appear here.</Empty></div>}
          </Card>

          <Card title={selected ? (chat?.lead?.name ?? current?.name ?? phoneOf(selected)) : "Pick a chat"}
            description={selected ? `${phoneOf(selected)}${chat?.lead ? ` · lead: ${chat.lead.status}` : ""}` : "Choose a client on the left, or open a new number."}>
            {!selected ? <Empty icon={Smartphone}>Select a conversation.</Empty> : chat?.error ? <p className="text-sm text-rose-300">{chat.error}</p> : (
              <>
                <div className="mb-3 max-h-[26rem] space-y-2 overflow-y-auto rounded-lg bg-panel-2/40 p-3">
                  {chat?.messages.length ? chat.messages.map((m) => (
                    <div key={m.id} className={`flex ${m.fromMe ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.fromMe ? "bg-emerald-900/60 text-emerald-50" : "bg-zinc-800 text-zinc-100"}`}>
                        {/* Plain text only: client messages are never rendered as HTML. */}
                        <p className="whitespace-pre-wrap break-words">{m.body || (m.hasMedia ? "📎 media" : "")}</p>
                        <p className="mt-0.5 text-right text-[10px] opacity-60">{time(m.at)}</p>
                      </div>
                    </div>
                  )) : <p className="text-center text-xs text-zinc-500">No messages yet — the first message counts toward today&apos;s new-people limit.</p>}
                </div>
                {canOperate && <Composer chatId={selected} canSend={canSend} disabled={chat?.optedOut ? "This person asked not to be messaged. The team will not message them again." : null} />}
              </>
            )}
          </Card>
        </div>
      )}

      <p className="mt-6 flex items-start gap-2 text-xs text-zinc-500">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Messages stay in your WhatsApp and your own gateway; AI Empire keeps only an audit of what was sent and who opted out. &quot;STOP&quot; or &quot;message mat karo&quot; blocks a contact for good. New contacts are capped at {s.dailyNewLimit} a day.</span>
      </p>
    </>
  );
}
