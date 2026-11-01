import type { AiStatus } from "@/lib/ai/registry";
import { Badge } from "@/components/ui";

export function AiStatusPanel({ status }: { status: AiStatus }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status.available ? "good" : "bad"}>{status.available ? "AI online" : "AI unavailable"}</Badge>
        <span className="text-sm text-slate-200">{status.label}{status.model ? ` · ${status.model}` : ""}</span>
      </div>
      <p className="text-xs text-muted">{status.detail}</p>
    </div>
  );
}
