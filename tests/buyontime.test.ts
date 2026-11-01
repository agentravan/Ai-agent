import { describe, expect, it } from "vitest";
import { parseTrendsRss } from "@/lib/integrations/trends";
import { meeshoSearch, orderRef, orderTask, parseIdeas } from "@/modules/buyontime/logic";
import { AiError } from "@/lib/ai/types";

describe("Google Trends RSS", () => {
  it("parses titles and traffic, decodes entities and dedupes", () => {
    const xml = `<rss><channel>
      <item><title>Diwali gifts</title><ht:approx_traffic>200K+</ht:approx_traffic></item>
      <item><title><![CDATA[Saree & lehenga]]></title></item>
      <item><title>diwali gifts</title></item>
    </channel></rss>`;
    expect(parseTrendsRss(xml)).toEqual([{ title: "Diwali gifts", traffic: "200K+" }, { title: "Saree & lehenga", traffic: null }]);
  });
  it("returns nothing for empty feeds", () => expect(parseTrendsRss("<rss></rss>")).toEqual([]));
});

describe("order → founder desk task", () => {
  const order = {
    orderNumber: "BOT123", placedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), status: "CONFIRMED", paymentMethod: "COD", totalPaise: 49900, shipTo: "Gurugram, Haryana 122001",
    items: [{ name: "Cotton Kurti", variant: "M", quantity: 2, supplier: "Meesho", supplierLink: "https://www.meesho.com/x/p/1" }, { name: "Dupatta", variant: null, quantity: 1, supplier: null, supplierLink: null }],
  };
  it("is idempotent by order number and lists supplier links", () => {
    const t = orderTask(order);
    expect(t.external_ref).toBe(orderRef("BOT123"));
    expect(t.title).toBe("Place Meesho order for Buyontime #BOT123");
    expect(t.description).toContain("2 × Cotton Kurti (M) — Meesho: https://www.meesho.com/x/p/1");
    expect(t.description).toContain("Dupatta — supplier link missing");
    expect(t.priority).toBe("high");
  });
  it("escalates orders waiting more than a day", () => expect(orderTask({ ...order, placedAt: new Date(Date.now() - 30 * 3_600_000).toISOString() }).priority).toBe("critical"));
});

describe("product ideas", () => {
  it("validates AI ideas and builds Meesho search links", () => {
    const ideas = parseIdeas('```json\n{"ideas":[{"product":"Diwali diya gift set","why":"Festival searches are trending","meesho_query":"diya gift set","category":"home"}]}\n```');
    expect(ideas[0]?.product).toBe("Diwali diya gift set");
    expect(meeshoSearch("diya gift set")).toBe("https://www.meesho.com/search?q=diya%20gift%20set");
  });
  it("rejects malformed output as retryable", () => {
    expect(() => parseIdeas("none")).toThrow(AiError);
    expect(() => parseIdeas('{"ideas":[]}')).toThrow(AiError);
  });
});
