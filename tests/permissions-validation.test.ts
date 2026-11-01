import { describe, expect, it } from "vitest";
import { assertCan, can, PermissionError } from "@/lib/permissions";
import { agentSchema, credentialsSchema, parseForm, taskSchema, ValidationError } from "@/lib/validation/forms";

describe("role capabilities", () => {
  it("matches the database write rules", () => {
    expect(can("founder", "own")).toBe(true);
    expect(can("admin", "govern")).toBe(true);
    expect(can("member", "govern")).toBe(false);
    expect(can("member", "operate")).toBe(true);
    expect(can("viewer", "operate")).toBe(false);
    expect(can(null, "read")).toBe(false);
  });
  it("assertCan throws PermissionError", () => expect(() => assertCan("viewer", "govern")).toThrow(PermissionError));
});

const form = (entries: [string, string][]) => { const f = new FormData(); entries.forEach(([k, v]) => f.append(k, v)); return f; };

describe("form validation", () => {
  it("normalises email and blocks open redirects", () => {
    expect(credentialsSchema.parse({ email: "A@B.com", password: "12345678", next: "//evil.com" })).toEqual({ email: "a@b.com", password: "12345678", next: undefined });
    expect(credentialsSchema.parse({ email: "a@b.com", password: "12345678", next: "/coo" }).next).toBe("/coo");
  });
  it("collects multi-value permissions and rejects unknown ones", () => {
    const base: [string, string][] = [["name", "Ava"], ["designation", "Writer"], ["tier", "worker"], ["instructions", ""], ["department_id", ""], ["manager_id", ""], ["monthly_cost_limit_cents", "0"]];
    expect(parseForm(agentSchema, form([...base, ["permissions", "ai.execute"], ["permissions", "tasks.create"]]), ["permissions"]).permissions).toEqual(["ai.execute", "tasks.create"]);
    expect(parseForm(agentSchema, form(base), ["permissions"]).permissions).toEqual([]);
    expect(() => parseForm(agentSchema, form([...base, ["permissions", "finance.spend"]]), ["permissions"])).toThrow(ValidationError);
  });
  it("maps empty optional ids to null and rejects bad uuids", () => {
    const t = parseForm(taskSchema, form([["title", "X"], ["description", ""], ["project_id", ""], ["assigned_agent_id", ""], ["due_date", ""]]));
    expect(t).toMatchObject({ project_id: null, assigned_agent_id: null, due_date: null, priority: "medium" });
    expect(() => parseForm(taskSchema, form([["title", "X"], ["description", ""], ["project_id", "nope"]]))).toThrow(ValidationError);
  });
  it("requires a title", () => expect(() => parseForm(taskSchema, form([["title", "  "]]))).toThrow("Title is required"));
});
