import { Badge, Card, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { executiveReportAction, messageExecutiveAction } from "@/modules/ceo/actions";
import type { AgentWithPermissions } from "@/types/domain";

/** Identity card + founder communication + report generation for an executive agent. */
export function ExecutiveConsole({ agent, returnTo, aiAvailable, canOperate, placeholder }: {
  agent: AgentWithPermissions | null; returnTo: "/ceo" | "/coo"; aiAvailable: boolean; canOperate: boolean; placeholder: string;
}) {
  if (!agent) return <Empty>No agent with this role exists. Create one in the Agent Registry.</Empty>;
  const disabled = !aiAvailable || !canOperate || agent.status !== "active";
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card title="Identity">
        <div className="text-lg font-semibold text-white">{agent.name}</div>
        <div className="text-sm text-muted">{agent.designation}</div>
        <div className="mt-2 flex flex-wrap gap-1.5"><Badge>{agent.tier}</Badge><Badge>{agent.status}</Badge></div>
        <p className="mt-3 text-sm whitespace-pre-wrap text-slate-300">{agent.instructions || "No role instructions configured."}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">{agent.agent_permissions.map((p) => <Badge key={p.permission} tone="neutral">{p.permission}</Badge>)}</div>
      </Card>
      <Card title="Founder communication" className="xl:col-span-2">
        <form action={messageExecutiveAction} className="space-y-3">
          <input type="hidden" name="agent_id" value={agent.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <textarea name="prompt" required maxLength={4000} rows={4} className="input" placeholder={placeholder} disabled={disabled} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">{!aiAvailable ? "AI execution unavailable — configure a provider in Settings." : agent.status !== "active" ? "Agent is suspended." : `Responses come from ${agent.name} using its role instructions.`}</p>
            {canOperate && <SubmitButton pendingText={`${agent.name} is thinking…`}>Send</SubmitButton>}
          </div>
        </form>
        {canOperate && (
          <form action={executiveReportAction} className="mt-4 border-t border-line pt-4">
            <input type="hidden" name="agent_id" value={agent.id} />
            <input type="hidden" name="return_to" value={returnTo} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted">Executive report grounded in live organisation data.</p>
              {!disabled && <SubmitButton variant="ghost" pendingText="Compiling…">Generate executive report</SubmitButton>}
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
