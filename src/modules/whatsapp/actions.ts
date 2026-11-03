"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AiError, AiUnavailableError } from "@/lib/ai/types";
import { PermissionError } from "@/lib/permissions";
import { UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { chatFromPhone, draftReply, sendMessage } from "./service";

const chatId = z.string().regex(/^\d{8,15}@(c\.us|s\.whatsapp\.net)$/, "Invalid chat");
const safe = (err: unknown) =>
  err instanceof UserFacingError || err instanceof AiError || err instanceof AiUnavailableError || err instanceof PermissionError ? err.message
    : err instanceof z.ZodError ? (err.issues[0]?.message ?? "Invalid input")
      : (console.error("[whatsapp]", err), "Something went wrong — please try again.");

/** Iris writes a draft for this chat. Nothing is sent. */
export async function draftReplyAction(id: string): Promise<{ ok: true; draft: string; care: string[]; agentId: string; agentName: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireContext("operate");
    return { ok: true, ...(await draftReply(ctx, chatId.parse(id))) };
  } catch (err) {
    return { ok: false, error: safe(err) };
  }
}

/** Sending is external communication: only the Founder or an admin ("govern") can press Send. */
export async function sendMessageAction(id: string, text: string, draftedBy: string | null): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const ctx = await requireContext("govern");
    const body = z.string().trim().min(1, "Write a message first").max(1500, "Keep it under 1,500 characters").parse(text);
    return { ok: true, message: await sendMessage(ctx, chatId.parse(id), body, draftedBy && z.uuid().safeParse(draftedBy).success ? draftedBy : null) };
  } catch (err) {
    return { ok: false, error: safe(err) };
  }
}

/** Opens a conversation with any number (a new client, or a lead's phone). */
export async function openNumberAction(form: FormData) {
  let target = "";
  try {
    await requireContext("operate");
    target = chatFromPhone(z.string().trim().min(6, "Enter a phone number").max(20).parse(String(form.get("phone") ?? "")));
  } catch (err) {
    unstable_rethrow(err);
    redirect(`/whatsapp?error=${encodeURIComponent(safe(err))}`);
  }
  redirect(`/whatsapp?chat=${encodeURIComponent(target)}`);
}
