import { env } from "@/lib/env";

export const emailConfigured = () => !!env.RESEND_API_KEY;

/** Sends one email through Resend (free tier). Throws a user-safe message on failure. */
export async function sendEmail(msg: { to: string; subject: string; text: string; html?: string; replyTo?: string }): Promise<string> {
  if (!env.RESEND_API_KEY) throw new Error("Email sending is not configured (RESEND_API_KEY).");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html, reply_to: msg.replyTo }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) throw new Error(`Email not sent: ${body.message ?? res.status}`);
  return body.id ?? "sent";
}
