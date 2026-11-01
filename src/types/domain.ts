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

export interface Profile {
  id: string;
  organisation_id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
}

export interface Organisation { id: string; name: string; created_at: string }
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
  monthly_cost_limit_cents: number;
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
