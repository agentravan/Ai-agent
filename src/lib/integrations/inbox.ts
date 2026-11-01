import "server-only";
import { ImapFlow } from "imapflow";
import { env } from "@/lib/env";
import { emailConfigured } from "./email";

export interface InboxMessage { from: string; subject: string; date: string; snippet: string }

/**
 * Reads the Founder's inbox (read-only, never deletes or marks as read) for messages
 * from the given addresses since a date. Used to detect client replies.
 */
export async function findReplies(fromAddresses: string[], since: Date, max = 200): Promise<InboxMessage[]> {
  if (!emailConfigured() || !fromAddresses.length) return [];
  const wanted = new Set(fromAddresses.map((a) => a.toLowerCase()));
  const client = new ImapFlow({
    host: env.IMAP_HOST, port: env.IMAP_PORT, secure: true,
    auth: { user: env.MAIL_USER!, pass: env.MAIL_PASSWORD! }, logger: false,
  });
  const found: InboxMessage[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const uids = (await client.search({ since }, { uid: true })) || [];
      const matches: { uid: number; from: string; subject: string; date: string }[] = [];
      for await (const m of client.fetch(uids.slice(-max), { envelope: true }, { uid: true })) {
        const from = m.envelope?.from?.[0]?.address?.toLowerCase();
        if (from && wanted.has(from)) matches.push({ uid: m.uid, from, subject: m.envelope?.subject ?? "", date: new Date(m.envelope?.date ?? Date.now()).toISOString() });
      }
      for (const m of matches) {
        // Part "1" is the text/plain body of single-part and multipart/alternative mail; download() decodes it.
        let text = "";
        try {
          const { content } = await client.download(String(m.uid), "1", { uid: true });
          const chunks: Buffer[] = [];
          if (content) for await (const c of content) chunks.push(Buffer.from(c));
          text = Buffer.concat(chunks).toString("utf8");
        } catch { /* body unavailable — subject still counts as a reply */ }
        found.push({ ...m, snippet: text.slice(0, 20_000) });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return found;
}
