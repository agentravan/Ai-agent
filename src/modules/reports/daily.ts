import "server-only";
import { activeProvider } from "@/lib/ai/registry";
import { formatInr } from "@/lib/utilities/format";
import type { AppContext } from "@/modules/auth/session";
import { cockpitFacts, loadCockpit } from "@/modules/cockpit/service";
import { loadAgentByTier, runAgent } from "@/modules/orchestration/engine";
import { runProspectingCycle } from "@/modules/sales/service";
import { runReadyTasks } from "@/modules/tasks/service";

export type Slot = "morning" | "evening";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface Report { subject: string; text: string; html: string }

/**
 * Builds the 09:00 briefing or 19:00 wrap-up from live data. The morning run first executes one
 * autonomous prospecting cycle; the evening run adds C-suite recommendations (AI, grounded in facts).
 */
export async function buildDailyReport(ctx: AppContext, slot: Slot, opts: { prospect?: boolean } = {}): Promise<Report> {
  const ai = !!activeProvider();
  const startedAt = Date.now();
  let prospecting: string | null = null;
  let autopilot: string[] = [];
  if (slot === "morning" && opts.prospect && ai) {
    prospecting = await runProspectingCycle(ctx).catch((e: Error) => `Prospecting failed: ${e.message}`);
    // Overnight-style work: let the team clear ready tasks within the job's time budget.
    // Serverless limit is 300 s: leave ~90 s for the report itself.
    const budget = Math.max(0, 200_000 - (Date.now() - startedAt));
    autopilot = (await runReadyTasks(ctx, budget).catch(() => [])).map((r) => `${r.ok ? "✓" : "✗"} ${r.message}`);
  }
  const c = await loadCockpit(ctx);
  const w = c.wall;
  const date = new Intl.DateTimeFormat("en-IN", { dateStyle: "full", timeZone: "Asia/Kolkata" }).format(new Date());

  let recommendations: string | null = null;
  if (slot === "evening" && ai) {
    const ceo = await loadAgentByTier(ctx, "ceo");
    if (ceo?.status === "active") {
      const { execution } = await runAgent(ctx, {
        agent: ceo, kind: "chat", maxTokens: 900,
        input: `[EOD] Give the Founder 3-5 strategic recommendations for tomorrow, each one line and tied to a KRA. Use ONLY these facts; never invent numbers.\n\nFACTS:\n${cockpitFacts(ctx, c)}`,
      }).catch(() => ({ execution: null }));
      recommendations = execution?.status === "succeeded" ? execution.output : null;
    }
  }

  const sections: [string, string[]][] = slot === "morning"
    ? [
        ["Yesterday's performance", [`${c.last24h.tasksDone} tasks completed, ${c.last24h.tasksCreated} created`, `${c.last24h.runsOk} agent runs succeeded, ${c.last24h.runsFailed} failed`, `${c.last24h.decisions} decisions taken`]],
        ["Done by the team this morning", autopilot.length ? autopilot : ["No tasks were ready"]],
        ["Today's plan", c.desk.filter((d) => d.entry.current).map((d) => `${d.agent.name}: ${d.entry.current!.title}`).slice(0, 8)],
        ["Client lead status", [`${c.sales.leadsFound24h} new leads found`, `${c.sales.awaitingApproval} pitches await your approval`, `${c.sales.readyToSend} approved & ready to send`, `${c.sales.contacted} contacted · ${c.sales.positive} positive · ${c.sales.won} won`, ...(prospecting ? [`Auto-prospecting: ${prospecting}`] : [])]],
        ["Needs you", [`${c.approvals.length} approval(s) pending`, ...c.risks.slice(0, 5)]],
        ["System health", [`AI: ${ai ? "configured" : "not configured"}`, "Database: OK"]],
      ]
    : [
        ["Today's money", [`Invoiced today: ${formatInr(w.revenueTodayCents)}`, `Payments received today: ${formatInr(w.receivedTodayCents)}`, `Outstanding dues: ${formatInr(w.outstandingCents)} (${w.outstandingCount} invoices, overdue ${formatInr(w.overdueCents)})`]],
        ["Projects", [`${w.activeProjects} active · ${w.pipelineProjects} in pipeline`, `${c.last24h.tasksDone} tasks completed today`]],
        ["Clients & sales", [`${w.newClients30} new clients (30d) · ${w.retainedClients} retained`, `${c.sales.contacted} contacted · ${c.sales.positive} positive · ${c.sales.won} won`]],
        ["Buyontime", ["New users today: integration pending"]],
        ["C-suite recommendations", recommendations ? recommendations.split("\n").filter((l) => l.trim()) : [ai ? "Not available this run" : "AI not configured"]],
        ["Needs you", [`${c.approvals.length} approval(s) pending`, ...c.risks.slice(0, 5)]],
      ];

  const title = slot === "morning" ? "Morning Briefing" : "Evening Wrap-up";
  const subject = `AI Empire · ${title} · ${date}`;
  const text = [`${title} — ${ctx.organisation.name}`, date, "", ...sections.flatMap(([h, items]) => [h.toUpperCase(), ...(items.length ? items.map((i) => `• ${i}`) : ["• Nothing to report"]), ""])].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:auto;color:#18181b">
<p style="color:#a1812f;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin:0">AI Empire OS</p>
<h1 style="font-size:22px;margin:4px 0">${esc(title)}</h1><p style="color:#71717a;margin:0 0 20px">${esc(ctx.organisation.name)} · ${esc(date)}</p>
${sections.map(([h, items]) => `<h2 style="font-size:14px;margin:20px 0 6px;border-bottom:1px solid #e4e4e7;padding-bottom:4px">${esc(h)}</h2><ul style="margin:0;padding-left:18px;color:#3f3f46;font-size:14px;line-height:1.6">${(items.length ? items : ["Nothing to report"]).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`).join("")}
<p style="color:#a1a1aa;font-size:12px;margin-top:28px">Figures are computed from your records. Open the cockpit to act on approvals.</p></div>`;
  return { subject, text, html };
}
