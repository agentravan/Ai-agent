"use server";

import { z } from "zod";
import { parseForm, promptSchema } from "@/lib/validation/forms";
import { runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { cockpitFacts, loadCockpit } from "@/modules/cockpit/service";
import { loadAgent, runAgent } from "@/modules/orchestration/engine";

const RETURN_PATHS = ["/ceo", "/coo", "/dashboard"] as const;
const returnPath = (form: FormData) => {
  const p = String(form.get("return_to") ?? "");
  return (RETURN_PATHS as readonly string[]).includes(p) ? p : "/ceo";
};

/** Founder ↔ executive communication. Each exchange is a persisted, audited execution. */
export async function messageExecutiveAction(form: FormData) {
  await runAction(returnPath(form), "Response received", async () => {
    const ctx = await requireContext("operate");
    const { agent_id, prompt } = parseForm(promptSchema, form);
    const agent = await loadAgent(ctx, agent_id);
    const { execution } = await runAgent(ctx, { agent, kind: "chat", input: prompt });
    if (execution.status === "failed") throw new UserFacingError(`${agent.name} could not respond: ${execution.error}`);
  });
}

const REPORTS = {
  briefing: {
    tag: "[BRIEFING]",
    ok: "Morning briefing ready",
    prompt: `Write the Founder's morning briefing (CEO Executive Cockpit summary). Use ONLY the facts below; never invent numbers, clients or events. If data is missing say "no data yet".
Sections: 1) Executive summary (last 24h, current focus) 2) Business units 3) Financial headline 4) Who is doing what 5) Strategic think-tank (ideas & risks) 6) Decisions awaiting Founder sign-off. Each line must reference a KRA where possible. Max 300 words.`,
  },
  eod: {
    tag: "[EOD]",
    ok: "End-of-day report ready",
    prompt: `Write today's end-of-day corporate status report for the Founder. Use ONLY the facts below; never invent figures.
Format: Completed today · In progress · Blockers & owners · KPI status · Escalations needing the Founder (only critical items, budget breaches or policy changes) · Plan for tomorrow. Concise bullet points.`,
  },
  report: {
    tag: "[REPORT]",
    ok: "Executive report ready",
    prompt: `Write a concise executive report for the Founder using ONLY the facts below. Sections: Summary, Risks, Recommended next actions (max 5, each tied to a KRA).`,
  },
} as const;

const reportSchema = z.object({ agent_id: z.uuid(), report: z.enum(["briefing", "eod", "report"]).default("report") });

/** Data-grounded reports: the AI only narrates facts computed from the database. */
export async function executiveReportAction(form: FormData) {
  const report = reportSchema.shape.report.catch("report").parse(form.get("report") ?? undefined);
  await runAction(returnPath(form), REPORTS[report].ok, async () => {
    const ctx = await requireContext("operate");
    const { agent_id } = parseForm(reportSchema, form);
    const agent = await loadAgent(ctx, agent_id);
    const facts = cockpitFacts(ctx, await loadCockpit(ctx));
    const { execution } = await runAgent(ctx, { agent, kind: "chat", maxTokens: 1800, input: `${REPORTS[report].tag} ${REPORTS[report].prompt}\n\nFACTS:\n${facts}` });
    if (execution.status === "failed") throw new UserFacingError(`Report failed: ${execution.error}`);
  });
}
