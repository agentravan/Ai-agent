import { describe, expect, it } from "vitest";
import catalog from "@/data/agency-agents.json";
import { parsePlaces, placesErrorMessage, positionOf } from "@/lib/integrations/google-places";
import { LEAD_CATEGORIES } from "@/lib/integrations/osm";
import { AGENT_PERMISSION_KEYS } from "@/lib/permissions";
import { AiError } from "@/lib/ai/types";
import { agentFromTemplate, departmentFor, RECOMMENDED_SLUGS, searchTemplates, type AgentTemplate } from "@/modules/library/logic";
import { buildPrompt, cleanDraft, LIMITS, shareLink } from "@/modules/linkedin/logic";
import { CHECK_INTERVAL_MS, describeRank, isDue, trend } from "@/modules/rank/logic";

describe("Google Places leads", () => {
  it("normalises places, skips unnamed, duplicate and permanently closed businesses", () => {
    const leads = parsePlaces([
      { id: "A", displayName: { text: "Iron Gym" }, formattedAddress: "Bandra West, Mumbai", internationalPhoneNumber: "+91 98200 00000", regularOpeningHours: {} },
      { id: "A", displayName: { text: "Iron Gym" } },
      { id: "B", displayName: { text: "Closed Gym" }, businessStatus: "CLOSED_PERMANENTLY" },
      { id: "C" },
      { id: "D", displayName: { text: "Fit Hub" }, nationalPhoneNumber: "022 1234 5678", websiteUri: "https://fithub.example" },
    ]);
    expect(leads).toHaveLength(2);
    expect(leads[0]).toMatchObject({ sourceRef: "A", name: "Iron Gym", phone: "+91 98200 00000", email: null, address: "Bandra West, Mumbai", hasHours: true });
    expect(leads[1]).toMatchObject({ sourceRef: "D", phone: "022 1234 5678", website: "https://fithub.example", hasHours: false });
  });
  it("finds 1-based positions and reports absence", () => {
    expect(positionOf(["x", "y", "z"], "y")).toBe(2);
    expect(positionOf(["x"], "q")).toBeNull();
  });
  it("turns Google errors into safe guidance", () => {
    expect(placesErrorMessage(403, null)).toMatch(/enable "Places API \(New\)"/);
    expect(placesErrorMessage(429, null)).toMatch(/quota/);
    expect(placesErrorMessage(400, { error: { message: "bad field" } })).toMatch(/bad field/);
  });
  it("has a search phrase for every lead category", () => {
    for (const c of Object.values(LEAD_CATEGORIES)) expect(c.search.length).toBeGreaterThan(2);
  });
});

describe("Agency Agents library", () => {
  const all = catalog.agents as AgentTemplate[];
  it("ships a valid catalog: unique slugs and names, every division labelled, licence recorded", () => {
    expect(all.length).toBeGreaterThan(100);
    expect(new Set(all.map((a) => a.slug)).size).toBe(all.length);
    expect(new Set(all.map((a) => a.name.toLowerCase())).size).toBe(all.length);
    for (const a of all) {
      expect(a.slug).toMatch(/^[a-z0-9/-]{3,120}$/);
      expect(catalog.divisions).toHaveProperty(a.division);
    }
    expect(catalog.license).toMatch(/^MIT License/);
  });
  it("recommends roles that exist", () => {
    for (const s of RECOMMENDED_SLUGS) expect(all.some((a) => a.slug === s)).toBe(true);
  });
  it("hired agents always fit the agents table limits", () => {
    for (const a of all) {
      const row = agentFromTemplate(a, "Marketing & Growth Division Long Label");
      expect(row.name.length).toBeLessThanOrEqual(80);
      expect(row.designation.length).toBeLessThanOrEqual(120);
      expect(row.instructions.length).toBeLessThanOrEqual(8000);
      expect(row.instructions).toContain("MIT licence");
    }
  });
  it("searches by every word and filters by division", () => {
    const linkedin = searchTemplates(all, "linkedin content");
    expect(linkedin.some((a) => a.slug === "marketing/marketing-linkedin-content-creator")).toBe(true);
    expect(searchTemplates(all, "", "sales").every((a) => a.division === "sales")).toBe(true);
    expect(searchTemplates(all, "zzzz-no-such-role")).toHaveLength(0);
    expect(searchTemplates(all, "", "", 5)).toHaveLength(5);
  });
  it("maps divisions to departments", () => {
    expect(departmentFor("sales")).toBe("Growth");
    expect(departmentFor("finance")).toBe("Finance");
    expect(departmentFor("engineering")).toBe("Operations");
    expect(departmentFor("game-development")).toBeNull();
  });
  it("offers the content.draft permission", () => expect(AGENT_PERMISSION_KEYS).toContain("content.draft"));
});

describe("LinkedIn content desk", () => {
  it("strips model wrappers", () => {
    expect(cleanDraft("```\nHello world\n```", "post")).toBe("Hello world");
    expect(cleanDraft("Here's your post:\nGreat news", "post")).toBe("Great news");
    expect(cleanDraft("\"Thanks Rohit!\"", "comment_reply")).toBe("Thanks Rohit!");
  });
  it("rejects empty output as retryable", () => {
    expect(() => cleanDraft("  ", "post")).toThrow(AiError);
  });
  it("enforces platform limits, cutting at a sentence or line", () => {
    const long = "Short sentence. ".repeat(200);
    const out = cleanDraft(long, "comment_reply");
    expect(out.length).toBeLessThanOrEqual(LIMITS.comment_reply);
    expect(out.endsWith(".")).toBe(true);
  });
  it("includes the reply context and recent hooks in prompts", () => {
    expect(buildPrompt("comment_reply", "thank them", "Love this!")).toContain("Love this!");
    expect(buildPrompt("post", "gym websites", null, ["Most gyms lose leads\nmore"])).toContain("Most gyms lose leads");
    expect(buildPrompt("post", "gym websites", null)).not.toContain("recent posts");
  });
  it("builds an encoded LinkedIn share link", () => {
    expect(shareLink("a b&c")).toBe("https://www.linkedin.com/feed/?shareActive=true&text=a%20b%26c");
  });
});

describe("rank tracker", () => {
  const now = new Date("2026-11-02T10:00:00Z");
  it("checks once per window", () => {
    expect(isDue(null, now)).toBe(true);
    expect(isDue(new Date(now.getTime() - CHECK_INTERVAL_MS + 60_000).toISOString(), now)).toBe(false);
    expect(isDue(new Date(now.getTime() - CHECK_INTERVAL_MS).toISOString(), now)).toBe(true);
  });
  it("classifies movement (lower is better)", () => {
    expect(trend(undefined, 4)).toBe("new");
    expect(trend(undefined, null)).toBe("absent");
    expect(trend(5, 3)).toBe("up");
    expect(trend(3, 5)).toBe("down");
    expect(trend(3, 3)).toBe("same");
    expect(trend(null, 9)).toBe("entered");
    expect(trend(9, null)).toBe("lost");
  });
  it("describes positions plainly", () => {
    expect(describeRank(2, 60)).toBe("#2");
    expect(describeRank(null, 60)).toBe("not in top 60");
    expect(describeRank(null, 0)).toBe("no results");
  });
});
