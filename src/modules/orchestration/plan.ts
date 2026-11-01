import { z } from "zod";
import { AiError } from "@/lib/ai/types";
import { PRIORITIES } from "@/types/domain";

export const PLAN_ACTIONS = ["create_project", "create_task", "create_founder_task", "create_opportunity", "request_approval"] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number];

export const planStepSchema = z.object({
  action: z.enum(PLAN_ACTIONS),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  assignee: z.string().trim().max(80).optional(),
  priority: z.enum(PRIORITIES).catch("medium").default("medium"),
  risk: z.enum(PRIORITIES).catch("high").default("low"),
  approval_action: z.string().regex(/^[a-z_]+\.[a-z_]+$/).optional().catch(undefined),
  kra: z.string().trim().max(120).optional().catch(undefined),
  task_type: z.enum(["call", "meeting", "order", "physical", "other"]).optional().catch("other"),
});

export const planSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  steps: z.array(planStepSchema).min(1).max(10),
});

export type PlanStep = z.infer<typeof planStepSchema>;
export type Plan = z.infer<typeof planSchema>;

export const PLAN_FORMAT_INSTRUCTIONS = `"summary" is your reply to the Founder: max 60 words, simple language, in the Founder's own language/style,
saying what you set up and what happens next. No numbers you were not given.
Plan 3-8 concrete steps. Start with ONE create_project for the initiative, then create_task steps that the AI employees can
actually do now (research, plans, drafts, website demo content, pitch copy, checklists) — each assigned to the best-fit agent.
Respond with ONLY a JSON object, no prose, matching:
{"summary": string, "steps": [{"action": "create_project"|"create_task"|"create_founder_task"|"create_opportunity"|"request_approval",
"title": string, "description": string, "assignee": agent name or omit, "priority": "low"|"medium"|"high"|"critical",
"risk": "low"|"medium"|"high"|"critical", "kra": one of the listed KRA names,
"approval_action": "domain.verb" (only for request_approval, e.g. "finance.spend", "external.contact", "budget.request"),
"task_type": "call"|"meeting"|"order"|"physical"|"other" (only for create_founder_task)}]}
Use create_founder_task ONLY for things an AI cannot do: phone calls, in-person meetings, placing/paying for orders, physical work.
Every step must name the KRA it serves. Assign work to the manager of the relevant business unit.
Mark anything involving money, legal exposure, external communication or irreversible change as risk "high" or use request_approval.`;

/** Extracts and validates a plan from model output. Invalid output is retryable: the model may comply next attempt. */
export function parsePlan(text: string): Plan {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("AI response contained no JSON plan", true);
  let raw: unknown;
  try {
    raw = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    throw new AiError("AI response contained malformed JSON", true);
  }
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) throw new AiError(`AI plan failed validation: ${parsed.error.issues[0]?.message ?? "invalid"}`, true);
  return parsed.data;
}
