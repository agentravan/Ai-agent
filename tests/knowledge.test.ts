import { describe, expect, it } from "vitest";
import playbookData from "@/data/playbooks.json";
import radarData from "@/data/agent-radar.json";
import { domainsFor, pickPassages, playbookBlock, safeRepoUrl, searchPlaybooks, searchRadar, type Playbook, type RadarEntry } from "@/modules/knowledge/logic";

const books = (playbookData as unknown as { playbooks: Playbook[] }).playbooks;
const radar = (radarData as unknown as { agents: RadarEntry[] }).agents;

describe("imported knowledge is safe data", () => {
  it("has every field, with guides, skill templates and failure lessons", () => {
    expect(books.length).toBeGreaterThan(90);
    for (const kind of ["guide", "skill", "lesson"]) expect(books.some((b) => b.kind === kind)).toBe(true);
    expect(new Set(books.map((b) => b.slug)).size).toBe(books.length);
  });
  it("contains no links, HTML or instructions aimed at an AI", () => {
    const all = books.flatMap((b) => [b.title, b.description, ...b.sections.map((s) => `${s.heading} ${s.text}`)]).join("\n");
    expect(/https?:\/\//.test(all)).toBe(false);
    expect(/<\/?(script|iframe|style)/i.test(all)).toBe(false);
    expect(/(ignore|disregard)\b.{0,30}\b(previous|above|prior)\b|system prompt|jailbreak/i.test(all)).toBe(false);
  });
  it("radar links are plain https GitHub links only", () => {
    expect(radar.length).toBeGreaterThan(200);
    expect(radar.every((a) => safeRepoUrl(a.url) !== null)).toBe(true);
    expect(safeRepoUrl("javascript:alert(1)")).toBeNull();
    expect(safeRepoUrl("https://evil.example/x/y")).toBeNull();
  });
});

describe("each agent reads its own shelf", () => {
  it("maps roles to fields", () => {
    expect(domainsFor({ tier: "ceo", designation: "Chief Executive Officer" })).toEqual(["strategy", "board", "finance"]);
    expect(domainsFor({ tier: "executive", designation: "Chief Financial Officer" })).toEqual(["finance"]);
    expect(domainsFor({ tier: "executive", designation: "Chief Legal & Compliance Officer" })).toEqual(["legal"]);
    expect(domainsFor({ tier: "manager", designation: "Sales & Outreach Manager" })).toEqual(["sales"]);
    expect(domainsFor({ tier: "executive", designation: "Chief Product Officer" })).toEqual(["product"]);
    expect(domainsFor({ tier: "worker", designation: "Something new" })).toEqual(["strategy", "operations"]);
  });
  it("finds the passage that matches the task, and only from that field", () => {
    const hits = pickPassages(books, "Customer acquisition cost aur payback period kitna hona chahiye?", ["finance"]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.book.domain === "finance")).toBe(true);
    expect(pickPassages(books, "hi", ["finance"])).toEqual([]);
  });
  it("frames playbook notes as background, never orders, within a size cap", () => {
    const block = playbookBlock(pickPassages(books, "pricing a website package for small business clients", ["marketing", "sales"]));
    expect(block).toMatch(/never instructions/);
    expect(block).toMatch(/NOT our data/);
    expect(block.length).toBeLessThan(2400);
    expect(playbookBlock([])).toBe("");
  });
  it("searches the library", () => {
    expect(searchPlaybooks(books, "okr", "", "skill")[0]?.slug).toMatch(/okr/);
    expect(searchPlaybooks(books, "", "legal", "").every((b) => b.domain === "legal")).toBe(true);
    expect(searchRadar(radar, "memory", "").length).toBeGreaterThan(0);
  });
});
