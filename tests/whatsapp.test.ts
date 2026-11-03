import { describe, expect, it } from "vitest";
import { parseChats, parseMessages, parseStatus } from "@/lib/integrations/waha";
import { chatIdFor, checkSend, cleanDraft, draftPrompt, isWaOptOut, lastInboundAt, needsCare, phoneOf, sendKind } from "@/modules/whatsapp/logic";

describe("WhatsApp Desk rules", () => {
  it("turns phone numbers into WhatsApp chat ids", () => {
    expect(chatIdFor("98765 43210")).toBe("919876543210@c.us");
    expect(chatIdFor("+91 98765-43210")).toBe("919876543210@c.us");
    expect(chatIdFor("09876543210")).toBe("919876543210@c.us");
    expect(chatIdFor("(415) 555-0100", "United States")).toBe("14155550100@c.us");
    expect(chatIdFor("12")).toBeNull();
    expect(chatIdFor(null)).toBeNull();
    expect(phoneOf("919876543210@c.us")).toBe("+919876543210");
  });
  it("honours opt-outs in English and Hinglish", () => {
    for (const t of ["STOP", "Please unsubscribe me", "message mat karo", "msg band karo", "ab mat bhejo", "not interested"]) expect(isWaOptOut(t)).toBe(true);
    for (const t of ["Price kya hai?", "Kal call karte hain", "Stopwatch app chahiye"]) expect(isWaOptOut(t)).toBe(false);
  });
  const msgs = [{ id: "1", fromMe: true, body: "Hi", at: 100, hasMedia: false }, { id: "2", fromMe: false, body: "Website chahiye", at: 200, hasMedia: false }];
  it("knows replies from first contacts", () => {
    expect(sendKind(msgs)).toBe("reply");
    expect(sendKind([msgs[0]!])).toBe("first_contact");
    expect(lastInboundAt(msgs)).toBe(200);
    expect(lastInboundAt([])).toBeNull();
  });
  it("blocks opted-out people, empty or huge messages, and new contacts past the daily cap", () => {
    const base = { text: "Namaste", optedOut: false, kind: "reply" as const, newToday: 0, dailyNewLimit: 10 };
    expect(checkSend(base)).toEqual({ ok: true });
    expect(checkSend({ ...base, optedOut: true }).ok).toBe(false);
    expect(checkSend({ ...base, text: "   " }).ok).toBe(false);
    expect(checkSend({ ...base, text: "x".repeat(1501) }).ok).toBe(false);
    expect(checkSend({ ...base, kind: "first_contact", newToday: 10 }).ok).toBe(false);
    expect(checkSend({ ...base, kind: "reply", newToday: 10 }).ok).toBe(true);
  });
  it("flags price, money, legal and promises for the Founder's eye", () => {
    expect(needsCare("Website ₹15,000 mein ho jayegi, 50% advance")).toEqual(["price", "money"]);
    expect(needsCare("Kal tak deliver kar denge, guarantee")).toEqual(["promise"]);
    expect(needsCare("Thanks! Kaunsa business hai aapka?")).toEqual([]);
  });
  it("drafts like a person and never invents prices", () => {
    const p = draftPrompt({ clientName: "Gym G", history: msgs, leadNote: "Gym in Gurugram, no website", founder: "Harshit" });
    expect(p).toContain("Gym G: Website chahiye");
    expect(p).toMatch(/NEVER invent prices/);
    expect(p).toMatch(/Harshit will share the exact quote/);
    expect(cleanDraft("```\nUs: **Namaste** ji!\n```")).toBe("*Namaste* ji!");
  });
});

describe("WAHA gateway parsing (tolerant of engine differences)", () => {
  it("reads the session status", () => {
    expect(parseStatus({ status: "WORKING" })).toBe("WORKING");
    expect(parseStatus({ status: "scan_qr_code" })).toBe("SCAN_QR_CODE");
    expect(parseStatus({})).toBe("UNKNOWN");
  });
  it("keeps one-to-one chats only, newest first", () => {
    const chats = parseChats([
      { id: { _serialized: "919876543210@c.us" }, name: "Gym G", timestamp: 50, unreadCount: 2, lastMessage: { body: "Hello", fromMe: false } },
      { id: "120363000000000000@g.us", name: "A group", timestamp: 99 },
      { id: "status@broadcast", timestamp: 98 },
      { id: "919999999999@c.us", conversationTimestamp: 70 },
    ]);
    expect(chats.map((c) => c.id)).toEqual(["919999999999@c.us", "919876543210@c.us"]);
    expect(chats[1]).toMatchObject({ name: "Gym G", unread: 2, lastText: "Hello", lastFromMe: false });
    expect(parseChats({ error: "x" })).toEqual([]);
  });
  it("reads messages oldest first and skips empty ones", () => {
    const m = parseMessages([
      { id: { _serialized: "b" }, timestamp: 20, fromMe: true, body: "Reply" },
      { id: "a", timestamp: 10, fromMe: false, body: "Hi" },
      { id: "c", timestamp: 30, body: "" },
      { id: "d", timestamp: 40, body: "", hasMedia: true },
    ]);
    expect(m.map((x) => x.id)).toEqual(["a", "b", "d"]);
    expect(m[2]!.hasMedia).toBe(true);
  });
});
