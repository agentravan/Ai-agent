import { z } from "zod";
import { AGENT_PERMISSION_KEYS } from "@/lib/permissions";
import { AGENT_STATUSES, AGENT_TIERS, KPI_PERIODS, PRIORITIES, PROJECT_STATUSES, TASK_STATUSES, OPPORTUNITY_STATUSES } from "@/types/domain";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const text = (max: number) => z.string().trim().max(max);
const required = (label: string, max: number) => z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);
const optionalUuid = z.preprocess((v) => (v === "" || v == null ? null : v), z.uuid().nullable());
const optionalDate = z.preprocess((v) => (v === "" || v == null ? null : v), z.iso.date().nullable());
const requiredKra = z.uuid({ message: "Choose the KRA this work serves" });
const rupees = (label: string) => z.coerce.number({ message: `${label} must be a number` }).positive(`${label} must be greater than 0`).max(1e12);
const toCents = (inr: number) => Math.round(inr * 100);

export const credentialsSchema = z.object({
  email: z.email("Enter a valid email").transform((e) => e.toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  next: z.string().regex(/^\/(?!\/)[\w\-/]*$/).optional().catch(undefined),
});

export const agentSchema = z.object({
  id: optionalUuid.optional(),
  name: required("Name", 80),
  designation: required("Designation", 120),
  tier: z.enum(AGENT_TIERS),
  instructions: text(8000),
  department_id: optionalUuid,
  manager_id: optionalUuid,
  business_unit_id: optionalUuid,
  monthly_cost_limit_cents: z.coerce.number().int().min(0).max(100_000_000),
  permissions: z.array(z.enum(AGENT_PERMISSION_KEYS as [string, ...string[]])).default([]),
});

export const agentStatusSchema = z.object({ id: z.uuid(), status: z.enum(AGENT_STATUSES) });

export const projectSchema = z.object({
  name: required("Name", 120),
  description: text(4000),
  status: z.enum(PROJECT_STATUSES).default("planned"),
  owner_agent_id: optionalUuid,
  business_unit_id: optionalUuid,
  kra_id: requiredKra,
  due_date: optionalDate,
});

export const projectStatusSchema = z.object({ id: z.uuid(), status: z.enum(PROJECT_STATUSES) });

export const taskSchema = z.object({
  title: required("Title", 200),
  description: text(8000),
  priority: z.enum(PRIORITIES).default("medium"),
  project_id: optionalUuid,
  assigned_agent_id: optionalUuid,
  kra_id: requiredKra,
  depends_on: optionalUuid.optional(),
  due_date: optionalDate,
});

export const taskUpdateSchema = z.object({
  id: z.uuid(),
  status: z.enum(TASK_STATUSES).optional(),
  assigned_agent_id: optionalUuid.optional(),
});

export const opportunitySchema = z.object({
  title: required("Title", 200),
  summary: text(8000),
  estimated_value_inr: z.coerce.number().min(0).max(1e12).optional().catch(undefined),
});

export const opportunityStatusSchema = z.object({ id: z.uuid(), status: z.enum(OPPORTUNITY_STATUSES) });

export const financialRecordSchema = z
  .object({
    kind: z.enum(["income", "expense"]),
    amount_inr: rupees("Amount"),
    occurred_on: z.iso.date("Choose a valid date"),
    description: text(500),
    business_unit_id: optionalUuid,
    budget_id: optionalUuid,
  })
  .transform(({ amount_inr, ...r }) => ({ ...r, amount_cents: toCents(amount_inr) }));

export const budgetSchema = z
  .object({
    name: required("Budget name", 120),
    amount_inr: rupees("Budget amount"),
    period_start: z.iso.date("Choose a start date"),
    period_end: z.iso.date("Choose an end date"),
    department_id: optionalUuid,
  })
  .refine((b) => b.period_end >= b.period_start, "End date must be on or after the start date")
  .transform(({ amount_inr, ...b }) => ({ ...b, amount_cents: toCents(amount_inr) }));

export const kraSchema = z.object({ name: required("KRA name", 120), description: text(2000), business_unit_id: optionalUuid });

export const kpiSchema = z.object({
  kra_id: requiredKra,
  name: required("KPI name", 120),
  unit: text(20),
  target: z.coerce.number().positive("Target must be greater than 0").max(1e12),
  current_value: z.coerce.number().min(0).max(1e12).default(0),
  period: z.enum(KPI_PERIODS).default("monthly"),
});

export const kpiValueSchema = z.object({ id: z.uuid(), current_value: z.coerce.number().min(0, "Value cannot be negative").max(1e12) });

export const commandSchema = z.object({ command: required("Command", 2000).min(3, "Command is too short") });
export const promptSchema = z.object({ agent_id: z.uuid(), prompt: required("Message", 4000) });
export const idSchema = z.object({ id: z.uuid() });
export const decisionSchema = z.object({
  id: z.uuid(),
  decision: z.enum(["approved", "rejected", "modified"]),
  note: text(2000),
  // Founder modifications (only used with decision = "modified").
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(PRIORITIES).optional().catch(undefined),
});

/** Parses FormData (multi-value keys become arrays when the schema expects arrays). */
export function parseForm<T extends z.ZodType>(schema: T, form: FormData, arrayKeys: string[] = []): z.infer<T> {
  const data: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    const values = form.getAll(key).filter((v): v is string => typeof v === "string");
    data[key] = arrayKeys.includes(key) ? values : values[0];
  }
  for (const key of arrayKeys) data[key] ??= [];
  const result = schema.safeParse(data);
  if (!result.success) throw new ValidationError(result.error.issues[0]?.message ?? "Invalid input");
  return result.data;
}
