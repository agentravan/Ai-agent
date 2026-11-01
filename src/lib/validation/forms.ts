import { z } from "zod";
import { AGENT_PERMISSION_KEYS } from "@/lib/permissions";
import { AGENT_STATUSES, AGENT_TIERS, PRIORITIES, PROJECT_STATUSES, TASK_STATUSES, OPPORTUNITY_STATUSES } from "@/types/domain";

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
  monthly_cost_limit_cents: z.coerce.number().int().min(0).max(100_000_000),
  permissions: z.array(z.enum(AGENT_PERMISSION_KEYS as [string, ...string[]])).default([]),
});

export const agentStatusSchema = z.object({ id: z.uuid(), status: z.enum(AGENT_STATUSES) });

export const projectSchema = z.object({
  name: required("Name", 120),
  description: text(4000),
  status: z.enum(PROJECT_STATUSES).default("planned"),
  owner_agent_id: optionalUuid,
  due_date: optionalDate,
});

export const projectStatusSchema = z.object({ id: z.uuid(), status: z.enum(PROJECT_STATUSES) });

export const taskSchema = z.object({
  title: required("Title", 200),
  description: text(8000),
  priority: z.enum(PRIORITIES).default("medium"),
  project_id: optionalUuid,
  assigned_agent_id: optionalUuid,
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

export const commandSchema = z.object({ command: required("Command", 2000).min(3, "Command is too short") });
export const promptSchema = z.object({ agent_id: z.uuid(), prompt: required("Message", 4000) });
export const idSchema = z.object({ id: z.uuid() });
export const decisionSchema = z.object({
  id: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  note: text(2000),
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
