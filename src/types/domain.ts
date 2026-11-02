/** Row shapes mirrored from supabase/migrations. Keep in sync with the schema. */
export const APP_ROLES = ["founder", "admin", "member", "viewer"] as const;
export const AGENT_TIERS = ["ceo", "coo", "executive", "manager", "worker"] as const;
export const AGENT_STATUSES = ["active", "suspended"] as const;
export const PROJECT_STATUSES = ["planned", "active", "on_hold", "completed", "cancelled"] as const;
export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done", "failed", "cancelled"] as const;
export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const EXECUTION_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export const OPPORTUNITY_STATUSES = ["proposed", "evaluating", "approved", "rejected", "won", "lost"] as const;

export type AppRole = (typeof APP_ROLES)[number];
export type AgentTier = (typeof AGENT_TIERS)[number];
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

/** Corporate hierarchy labels for agent tiers (Tier 4 is the human Founder). */
export const TIER_LABEL: Record<AgentTier, string> = {
  ceo: "C-Suite · Chief Executive",
  coo: "C-Suite · Chief Operating",
  executive: "Tier 3 · Senior VP / Division Head",
  manager: "Tier 2 · Team Manager",
  worker: "Tier 1 · Associate / Specialist",
};
export const KPI_PERIODS = ["daily", "weekly", "monthly", "quarterly"] as const;
export type KpiPeriod = (typeof KPI_PERIODS)[number];

export interface Profile {
  id: string;
  organisation_id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
}

export interface Organisation {
  id: string; name: string; created_at: string;
  /** INR paise, derived in the database from north_star_usd × usd_inr_rate. */
  north_star_target_cents?: number; upgrade_profit_gate_cents?: number;
  north_star_usd?: number; usd_inr_rate?: number;
}
export const FOUNDER_TASK_TYPES = ["call", "meeting", "order", "physical", "other"] as const;
export interface Department { id: string; name: string; description: string | null }

export interface Agent {
  id: string;
  organisation_id: string;
  name: string;
  designation: string;
  tier: AgentTier;
  instructions: string;
  department_id: string | null;
  manager_id: string | null;
  status: AgentStatus;
  business_unit_id: string | null;
  monthly_cost_limit_cents: number;
  /** Set when hired from the Agency Agents library. */
  template_slug?: string | null;
  created_at: string;
}

export interface AgentWithPermissions extends Agent {
  agent_permissions: { permission: string }[];
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  owner_agent_id: string | null;
  business_unit_id: string | null;
  kra_id: string | null;
  due_date: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  organisation_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  assigned_agent_id: string | null;
  kra_id: string | null;
  owner?: "agent" | "founder";
  task_type?: "work" | "call" | "meeting" | "order" | "physical" | "other";
  lead_id?: string | null;
  result: string | null;
  due_date: string | null;
  created_at: string;
}

export interface Execution {
  id: string;
  agent_id: string | null;
  task_id: string | null;
  kind: "task" | "command" | "chat";
  status: ExecutionStatus;
  input: string;
  output: string | null;
  plan: unknown;
  error: string | null;
  attempts: number;
  max_attempts: number;
  provider: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface Opportunity {
  id: string;
  title: string;
  summary: string | null;
  status: OpportunityStatus;
  estimated_value_cents: number | null;
  proposed_by_agent_id: string | null;
  created_at: string;
}

export interface Approval {
  id: string;
  title: string;
  action_type: string;
  payload: Record<string, unknown>;
  risk: Priority;
  status: ApprovalStatus;
  requested_by_agent_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export interface AuditLog {
  id: number;
  actor_type: "user" | "agent" | "system";
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface BusinessUnit { id: string; name: string; description: string | null; department_id: string | null; manager_agent_id: string | null }
export interface Kra { id: string; name: string; description: string | null; business_unit_id: string | null }
export interface Kpi { id: string; kra_id: string; name: string; unit: string; target: number; current_value: number; period: KpiPeriod; updated_at: string }
export interface FinancialRecord {
  id: string;
  kind: "income" | "expense";
  amount_cents: number;
  currency: string;
  occurred_on: string;
  description: string | null;
  business_unit_id: string | null;
  budget_id: string | null;
  client_id: string | null;
  created_at: string;
}
export interface Budget { id: string; name: string; department_id: string | null; period_start: string; period_end: string; amount_cents: number; currency: string }
export interface Client { id: string; name: string; status: "lead" | "active" | "churned"; business_unit_id: string | null }

/** LinkedIn content desk drafts (the Founder posts approved text by hand). */
export const LINKEDIN_KINDS = ["post", "comment_reply", "dm_reply"] as const;
export type LinkedinKind = (typeof LINKEDIN_KINDS)[number];
export interface LinkedinDraft {
  id: string; organisation_id: string; kind: LinkedinKind; brief: string; context: string | null; body: string | null;
  status: "draft" | "approved" | "posted" | "discarded"; agent_id: string | null; posted_at: string | null; created_at: string;
}

/** Local rank tracker: where a business ranks on Google for a keyword. */
export interface RankKeyword {
  id: string; organisation_id: string; keyword: string; business: string; place_id: string | null; place_name: string | null;
  place_address: string | null; active: boolean; last_position: number | null; last_checked_at: string | null; last_error: string | null; created_at: string;
}
export interface RankCheck { id: string; keyword_id: string; position: number | null; scanned: number; checked_at: string }

/** Meetings: board (C-suite), team (a leader and their reports), daily morning / evening stand-ups. */
export const MEETING_KINDS = ["board", "team", "morning", "evening"] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];
export interface Mom {
  summary: string;
  decisions: string[];
  action_items: { owner: string; task: string; due: string; needs_approval: boolean }[];
  risks: string[];
  opportunities: string[];
  follow_ups: string[];
  next_agenda: string[];
}
export interface BoardMeeting {
  id: string; organisation_id: string; topic: string; status: "in_progress" | "done" | "failed"; summary: string | null;
  plan_execution_id: string | null; error: string | null; created_at: string;
  kind: MeetingKind; host_agent_id: string | null; participant_ids: string[]; meeting_date: string | null;
  mom: Mom | null; mom_execution_id: string | null; mom_emailed_at: string | null; ended_at: string | null;
}
export interface BoardMessage {
  id: string; meeting_id: string; seq: number; agent_id: string | null; speaker: string; body: string; failed: boolean;
  role: "member" | "founder" | "scribe" | "system"; created_at: string;
}
