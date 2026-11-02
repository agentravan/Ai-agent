/** Pure LinkedIn content desk rules: prompts, output cleanup and share links. No I/O: unit-tested. */
import { AiError } from "@/lib/ai/types";
import type { LinkedinKind } from "@/types/domain";

/** LinkedIn's limits: 3,000 characters for a post, 1,250 for a comment. DMs are kept short on purpose. */
export const LIMITS: Record<LinkedinKind, number> = { post: 3000, comment_reply: 1250, dm_reply: 1000 };

export const KIND_LABEL: Record<LinkedinKind, string> = { post: "Post", comment_reply: "Comment reply", dm_reply: "DM reply" };

const RULES = `Rules: write as the Founder in first person; plain words; no hashtag spam (max 3 hashtags, posts only); no emojis unless the Founder used them;
never invent facts, client names, numbers or results; no links unless given; no "As an AI". Output ONLY the text to publish — no title, no quotes, no notes.`;

export function buildPrompt(kind: LinkedinKind, brief: string, context: string | null, recentPosts: string[] = []): string {
  const ctx = context?.trim() ? `\n\nWhat I am replying to:\n"""${context.trim().slice(0, 4000)}"""` : "";
  const recent = recentPosts.length
    ? `\nMy recent posts started like this — use a fresh hook and angle, don't repeat them:\n${recentPosts.slice(0, 5).map((p) => `- ${p.split("\n")[0]?.slice(0, 140)}`).join("\n")}`
    : "";
  switch (kind) {
    case "post":
      return `Write a LinkedIn post for me. Topic and points: ${brief}${ctx}${recent}
Shape: a strong first line (hook) under 15 words, short lines with white space, one useful takeaway or story, end with one easy question to invite comments. 80–220 words.
${RULES}`;
    case "comment_reply":
      return `Write my reply to this comment on my LinkedIn post. My intent: ${brief}${ctx}
Shape: warm, specific to what they said, 1–3 short sentences. If they ask for help or a call, offer a quick DM — no hard selling.
${RULES}`;
    case "dm_reply":
      return `Write my LinkedIn direct-message reply. My intent: ${brief}${ctx}
Shape: friendly and human, under 90 words, answer what they asked, suggest one clear next step (e.g. a 15-minute call).
${RULES}`;
  }
}

/** Strips wrappers models add (fences, quotes, "Here's your post:") and enforces the platform limit. Empty output is retryable. */
export function cleanDraft(text: string, kind: LinkedinKind): string {
  let t = text.replace(/```[a-z]*\n?/gi, "").trim();
  t = t.replace(/^(here(?:'s| is)[^\n:]{0,60}:)\s*/i, "").trim();
  if (/^["“].*["”]$/s.test(t)) t = t.slice(1, -1).trim();
  if (t.length < 2) throw new AiError("AI returned an empty draft", true);
  const limit = LIMITS[kind];
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  const end = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return (end > limit * 0.6 ? cut.slice(0, end + 1) : cut).trim();
}

/** Opens LinkedIn's composer with the post pre-filled (the Founder still presses Post). */
export function shareLink(text: string): string {
  return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;
}
