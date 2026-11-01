import { Badge, Empty } from "@/components/ui";
import { formatDateTime, truncate } from "@/lib/utilities/format";
import type { Execution } from "@/types/domain";

/** Execution tracking: status, attempts, provider, tokens, cost and output/error for each agent run. */
export function ExecutionList({ executions, agentNames, empty }: { executions: Execution[]; agentNames: Map<string, string>; empty: string }) {
  if (!executions.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="space-y-3">
      {executions.map((e) => (
        <li key={e.id} className="rounded-lg border border-line bg-ink/40 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge>{e.status}</Badge>
            <span className="text-slate-200">{agentNames.get(e.agent_id ?? "") ?? "Unknown agent"}</span>
            <span>· {e.kind}</span>
            <span>· attempt {e.attempts}/{e.max_attempts}</span>
            {e.provider && <span>· {e.provider}/{e.model}</span>}
            <span>· {e.input_tokens + e.output_tokens} tokens</span>
            <span className="ml-auto">{formatDateTime(e.created_at)}</span>
          </div>
          <p className="mt-2 text-sm text-slate-300"><span className="text-muted">Input: </span>{truncate(e.input, 240)}</p>
          {e.output && e.kind !== "command" && <div className="mt-2 max-h-80 overflow-y-auto text-sm whitespace-pre-wrap text-slate-100">{e.output}</div>}
          {e.error && <p className="mt-2 text-sm text-rose-300">{e.error}</p>}
        </li>
      ))}
    </ul>
  );
}
