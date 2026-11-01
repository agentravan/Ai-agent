import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";

/** Email through the Founder's own mailbox (SMTP). No third-party sending service. */
export const emailConfigured = () => !!(env.MAIL_USER && env.MAIL_PASSWORD);

let transport: Transporter | null = null;
function smtp(): Transporter {
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.MAIL_USER, pass: env.MAIL_PASSWORD },
    connectionTimeout: 15_000,
    socketTimeout: 20_000,
  });
  return transport;
}

export function outreachFooter(address = env.BUSINESS_ADDRESS): string {
  return ["", "—", address ? `${env.MAIL_FROM_NAME} · ${address}` : env.MAIL_FROM_NAME, `Not interested? Reply "unsubscribe" and we won't contact you again.`].join("\n");
}

export async function sendEmail(msg: { to: string; subject: string; text: string; html?: string; replyTo?: string; outreach?: boolean }): Promise<string> {
  if (!emailConfigured()) throw new Error("Your mailbox is not connected yet (MAIL_USER / MAIL_PASSWORD).");
  try {
    const info = await smtp().sendMail({
      from: { name: env.MAIL_FROM_NAME, address: env.MAIL_USER! },
      to: msg.to,
      subject: msg.subject,
      text: msg.outreach ? `${msg.text}${outreachFooter()}` : msg.text,
      html: msg.html,
      replyTo: msg.replyTo,
      headers: msg.outreach ? { "List-Unsubscribe": `<mailto:${env.MAIL_USER}?subject=unsubscribe>` } : undefined,
    });
    return info.messageId;
  } catch (err) {
    const m = (err as { responseCode?: number; message?: string });
    if (m.responseCode === 535) throw new Error("Mailbox login failed — check the App Password.");
    throw new Error(`Email not sent: ${m.message?.slice(0, 160) ?? "unknown error"}`);
  }
}
