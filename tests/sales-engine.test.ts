import { describe, expect, it } from "vitest";
import { buildOverpassQuery, parseOverpass } from "@/lib/integrations/osm";
import { invoiceSummary } from "@/modules/cockpit/metrics";
import { learnFromOutcomes, mailtoLink, parseDecisions, scoreLead, whatsappLink, whatsappNumber } from "@/modules/sales/logic";
import { AiError } from "@/lib/ai/types";

describe("OpenStreetMap discovery", () => {
  it("builds a bounded Overpass query for every category filter", () => {
    const q = buildOverpassQuery("salon", 3600123, 500);
    expect(q).toContain('nwr["shop"="hairdresser"](area.a);');
    expect(q).toContain('nwr["shop"="beauty"](area.a);');
    expect(q).toContain("area(id:3600123)");
    expect(q).toContain("out center tags 200;");
  });
  it("normalises businesses, skips unnamed and duplicates", () => {
    const leads = parseOverpass({ elements: [
      { type: "node", id: 1, tags: { name: "Glow Salon", phone: "+1 214 555 0100", "addr:housenumber": "12", "addr:street": "Main St", "addr:city": "Dallas", opening_hours: "Mo-Sa 09:00-19:00" } },
      { type: "node", id: 1, tags: { name: "Glow Salon" } },
      { type: "way", id: 2, tags: { name: "Cuts & Co", website: "https://cuts.example", "contact:email": "hi@cuts.example" } },
      { type: "node", id: 3, tags: { shop: "hairdresser" } },
    ] });
    expect(leads).toHaveLength(2);
    expect(leads[0]).toMatchObject({ sourceRef: "node/1", name: "Glow Salon", phone: "+1 214 555 0100", website: null, address: "12 Main St, Dallas", hasHours: true });
    expect(leads[1]).toMatchObject({ sourceRef: "way/2", website: "https://cuts.example", email: "hi@cuts.example" });
  });
});

describe("lead scoring", () => {
  const base = { category: "salon", city: "Dallas", phone: null, email: null, website: null, instagram: null, address: null };
  it("rewards no website plus reachable channels for website offers", () => {
    expect(scoreLead({ ...base, phone: "1", email: "e", address: "a", hasHours: true })).toBe(92);
    expect(scoreLead({ ...base, website: "x", phone: "1" })).toBe(20);
  });
  it("caps at 100", () => expect(scoreLead({ ...base, phone: "1", email: "e", instagram: "i", address: "a", hasHours: true })).toBe(100));
});

describe("learning loop", () => {
  const L = (category: string, status: string, website: string | null = null, city = "Dallas") => ({ category, city, website, status });
  it("has a safe default before any outcomes", () => expect(learnFromOutcomes([]).summary).toMatch(/No outcomes/));
  it("ranks segments by positive rate once samples are sufficient", () => {
    const l = learnFromOutcomes([
      L("salon", "replied"), L("salon", "won"), L("salon", "lost"),
      L("dentist", "lost"), L("dentist", "lost"), L("dentist", "contacted"),
    ]);
    expect(l).toMatchObject({ contacted: 6, replied: 2, won: 1 });
    expect(l.segments[0]).toMatchObject({ key: "category:salon", rate: 67 });
    expect(l.summary).toMatch(/Best segments: category = salon 67%/);
    expect(l.summary).toMatch(/Weakest: category = dentist 0%/);
  });
  it("ignores leads never contacted", () => expect(learnFromOutcomes([L("salon", "new"), L("salon", "pitch_ready")]).contacted).toBe(0));
});

describe("outreach links", () => {
  it("normalises US numbers and international formats", () => {
    expect(whatsappNumber("(214) 555-0100", "United States")).toBe("12145550100");
    expect(whatsappNumber("+44 20 7946 0958", null)).toBe("442079460958");
    expect(whatsappNumber("0091 98765 43210", null)).toBe("919876543210");
    expect(whatsappNumber("555-0100", "United States")).toBeNull();
    expect(whatsappNumber(null, "United States")).toBeNull();
    expect(whatsappNumber("+1 214 555 0100; +1 214 555 0199", null)).toBe("12145550100");
  });
  it("encodes message text", () => {
    expect(whatsappLink("+1 214 555 0100", null, "Hi & hello")).toBe("https://wa.me/12145550100?text=Hi%20%26%20hello");
    expect(mailtoLink("a@b.com", "S", "B")).toBe("mailto:a%40b.com?subject=S&body=B");
  });
});

describe("AI qualification parsing", () => {
  const ok = { decisions: [
    { ref: 1, pitch: true, reason: "No website, phone listed", email_subject: "Hi", email_body: "Body", whatsapp: "Hi there" },
    { ref: 2, pitch: false, reason: "Already has a website" },
    { ref: 1, pitch: false, reason: "duplicate ref ignored" },
    { ref: 9, pitch: true, reason: "out of range", whatsapp: "x" },
  ] };
  it("keeps valid, in-range, first decisions only", () => {
    const d = parseDecisions("```json\n" + JSON.stringify(ok) + "\n```", 2);
    expect(d.map((x) => [x.ref, x.pitch])).toEqual([[1, true], [2, false]]);
  });
  it("drops pitches with no message to send", () => {
    expect(parseDecisions(JSON.stringify({ decisions: [{ ref: 1, pitch: true, reason: "fit but empty" }] }), 1)).toEqual([]);
  });
  it("treats malformed output as retryable", () => {
    expect(() => parseDecisions("no json", 1)).toThrow(AiError);
    expect(() => parseDecisions('{"decisions": []}', 1)).toThrow(AiError);
  });
});

describe("CFO invoice summary", () => {
  const inv = (o: Partial<{ amount_cents: number; status: "draft" | "sent" | "paid" | "void"; due_on: string; paid_on: string | null; issued_on: string }>) =>
    ({ amount_cents: 1000, status: "sent" as const, due_on: "2026-11-20", paid_on: null, issued_on: "2026-11-01", ...o });
  it("separates outstanding, overdue, received and invoiced today", () => {
    const s = invoiceSummary([
      inv({ amount_cents: 5000 }),
      inv({ amount_cents: 3000, due_on: "2026-11-10" }),
      inv({ amount_cents: 2000, status: "paid", paid_on: "2026-11-15" }),
      inv({ amount_cents: 9999, status: "void", issued_on: "2026-11-15" }),
      inv({ amount_cents: 700, issued_on: "2026-11-15", due_on: "2026-11-30" }),
    ], new Date("2026-11-15T12:00:00Z"));
    expect(s).toEqual({ outstandingCents: 8700, outstandingCount: 3, overdueCents: 3000, overdueCount: 1, receivedTodayCents: 2000, invoicedTodayCents: 700 });
  });
});
