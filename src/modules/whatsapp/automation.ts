import "server-only";
import { env } from "@/lib/env";
import { activeProvider } from "@/lib/ai/registry";
import { sendText, type InboundMessage } from "@/lib/integrations/waha";
import { UserFacingError } from "@/lib/utilities/action";
import { logEvent } from "@/modules/audit/service";
import type { AppContext } from "@/modules/auth/session";
import { autoDecision, checkSend, isWaOptOut, phoneOf } from "./logic";
import { draftReply } from "./service";

export const WHATSAPP_ACTION = "external.whatsapp_reply";
type Handled = "auto_sent" | "needs_approval" | "opted_out" | "skipped" | "failed";

/**
 * One incoming client message (from the verified WAHA webhook, server context):
 * opt-out → remembered forever; otherwise Iris drafts. Under the Founder's "safe" policy a simple answer is sent
 * at once; anything about price, money, legal, dates, media — or policy off — goes to the Approval Center.
 * Each message is handled exactly once (unique WhatsApp id).
 */
export async function handleInbound(ctx: AppContext, msg: InboundMessage): Promise<Handled | "duplicate"> {
  const org = ctx.organisation.id;
  const { data: row } = await ctx.db.from("whatsapp_inbound")
    .upsert({ organisation_id: org, wa_message_id: msg.id, chat_id: msg.chatId, body: msg.body || null }, { onConflict: "organisation_id,wa_message_id", ignoreDuplicates: true })
    .select("id").maybeSingle<{ id: string }>();
  if (!row) return "duplicate";
  const mark = async (handled: Handled, note?: string, approvalId?: string) => {
    await ctx.db.from("whatsapp_inbound").update({ handled, note: note?.slice(0, 500) ?? null, approval_id: approvalId ?? null }).eq("id", row.id);
    return handled;
  };

  const { data: contact } = await ctx.db.from("whatsapp_contacts").select("opted_out").eq("organisation_id", org).eq("chat_id", msg.chatId).maybeSingle<{ opted_out: boolean }>();
  if (contact?.opted_out) return mark("skipped", "contact opted out earlier");
  if (isWaOptOut(msg.body)) {
    await ctx.db.from("whatsapp_contacts").upsert({ organisation_id: org, chat_id: msg.chatId, opted_out: true, opted_out_at: new Date().toISOString() }, { onConflict: "organisation_id,chat_id" });
    await logEvent(ctx, { action: "whatsapp.opt_out", entity: "whatsapp_contacts", actorType: "agent", metadata: { chat: msg.chatId.slice(-4) } });
    return mark("opted_out");
  }
  if (!activeProvider()) return mark("skipped", "AI not configured");

  let draft: Awaited<ReturnType<typeof draftReply>>;
  try {
    draft = await draftReply(ctx, msg.chatId);
  } catch (err) {
    return mark("failed", err instanceof UserFacingError ? err.message : "Iris could not draft a reply");
  }

  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count: autoSentLastHour } = await ctx.db.from("whatsapp_sends").select("id", { count: "exact", head: true })
    .eq("organisation_id", org).eq("chat_id", msg.chatId).is("sent_by", null).gte("created_at", since);
  const decision = autoDecision({ policy: env.WHATSAPP_AUTO_REPLY, inbound: msg.body, draft: draft.draft, autoSentLastHour: autoSentLastHour ?? 0, hasMedia: msg.hasMedia });

  if (decision.action === "send") {
    const check = checkSend({ text: draft.draft, optedOut: false, kind: "reply", newToday: 0, dailyNewLimit: env.WHATSAPP_DAILY_NEW_LIMIT });
    if (!check.ok) return mark("failed", check.reason);
    try {
      const waId = await sendText(msg.chatId, draft.draft);
      await ctx.db.from("whatsapp_sends").insert({ organisation_id: org, chat_id: msg.chatId, body: draft.draft, kind: "reply", drafted_by: draft.agentId, sent_by: null, wa_message_id: waId });
      await logEvent(ctx, { action: "whatsapp.auto_sent", entity: "whatsapp_sends", actorType: "agent", metadata: { chat: msg.chatId.slice(-4), policy: "safe" } });
      return mark("auto_sent");
    } catch {
      return mark("failed", "the WhatsApp gateway did not accept the reply");
    }
  }

  // Needs the Founder: one tap in the Approval Center sends Iris's draft (or his edited text).
  const { data: approval } = await ctx.db.from("approvals").insert({
    organisation_id: org,
    title: `WhatsApp reply to ${phoneOf(msg.chatId)}`.slice(0, 200),
    action_type: WHATSAPP_ACTION,
    risk: decision.reasons.some((r) => /price|money|legal/.test(r)) ? "high" : "medium",
    requested_by_agent_id: draft.agentId,
    payload: { chat_id: msg.chatId, text: draft.draft, client_said: msg.body.slice(0, 1000), why_review: decision.reasons, drafted_by: draft.agentName },
  }).select("id").single<{ id: string }>();
  return mark("needs_approval", decision.reasons.join("; "), approval?.id);
}

/** The Founder approved (or edited) a WhatsApp reply in the Approval Center: send it now. */
export async function sendApprovedReply(ctx: AppContext, payload: Record<string, unknown>, editedText?: string): Promise<string> {
  const chatId = typeof payload.chat_id === "string" ? payload.chat_id : "";
  const text = (editedText?.trim() || (typeof payload.text === "string" ? payload.text : "")).trim();
  if (!/^\d{8,15}@(c\.us|s\.whatsapp\.net)$/.test(chatId)) throw new UserFacingError("This approval has no valid WhatsApp chat");
  const { data: contact } = await ctx.db.from("whatsapp_contacts").select("opted_out").eq("organisation_id", ctx.organisation.id).eq("chat_id", chatId).maybeSingle<{ opted_out: boolean }>();
  const check = checkSend({ text, optedOut: contact?.opted_out ?? false, kind: "reply", newToday: 0, dailyNewLimit: env.WHATSAPP_DAILY_NEW_LIMIT });
  if (!check.ok) throw new UserFacingError(check.reason);
  const waId = await sendText(chatId, text).catch(() => { throw new UserFacingError("The WhatsApp gateway did not accept the message — is it online?"); });
  await ctx.db.from("whatsapp_sends").insert({
    organisation_id: ctx.organisation.id, chat_id: chatId, body: text.slice(0, 4000), kind: "reply", sent_by: ctx.userId, wa_message_id: waId,
    drafted_by: null,
  });
  return `whatsapp:${phoneOf(chatId)}`;
}
