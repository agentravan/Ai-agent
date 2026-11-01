import type { AppRole } from "@/types/domain";

/** Human (user) capabilities. Mirrors auth_can_write() in the database: UI hints + server-side guard. */
export const CAPABILITIES = {
  read: ["founder", "admin", "member", "viewer"],
  operate: ["founder", "admin", "member"], // tasks, projects, opportunities, commands, executions
  govern: ["founder", "admin"], // agents, permissions, approvals decisions, finance
  own: ["founder"], // organisation settings
} as const satisfies Record<string, readonly AppRole[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: AppRole | null | undefined, capability: Capability): boolean {
  return !!role && (CAPABILITIES[capability] as readonly AppRole[]).includes(role);
}

export class PermissionError extends Error {
  constructor(capability: string) {
    super(`Permission denied: requires "${capability}"`);
    this.name = "PermissionError";
  }
}

export function assertCan(role: AppRole | null | undefined, capability: Capability): void {
  if (!can(role, capability)) throw new PermissionError(capability);
}

/** Agent permissions: what an AI employee may do autonomously. */
export const AGENT_PERMISSIONS = {
  "ai.execute": "Run AI reasoning using the configured provider",
  "tasks.create": "Create tasks",
  "tasks.delegate": "Assign tasks to other agents",
  "projects.create": "Create projects",
  "opportunities.create": "Propose business opportunities",
  "approvals.request": "Raise approval requests to the founder",
  "reports.create": "Produce executive reports",
  "leads.qualify": "Score and qualify sales leads",
  "outreach.draft": "Draft outreach pitches (sending always needs Founder approval)",
} as const;

export type AgentPermission = keyof typeof AGENT_PERMISSIONS;
export const AGENT_PERMISSION_KEYS = Object.keys(AGENT_PERMISSIONS) as AgentPermission[];

export function agentHas(permissions: readonly string[], permission: AgentPermission): boolean {
  return permissions.includes(permission);
}
