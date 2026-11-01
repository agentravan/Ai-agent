import Link from "next/link";
import { Badge, Card, PageHeader, Table, Td, type SearchParams } from "@/components/ui";
import { cn, formatDateTime, humanize } from "@/lib/utilities/format";
import { listAudit } from "@/modules/audit/service";
import { requireContext } from "@/modules/auth/session";

export const metadata = { title: "Audit Log" };

const FILTERS = [
  { label: "All", q: "" },
  { label: "User activity", q: "actor=user" },
  { label: "Agent activity", q: "actor=agent" },
  { label: "Task history", q: "entity=tasks" },
  { label: "Agents & permissions", q: "entity=agents" },
  { label: "Approvals", q: "entity=approvals" },
  { label: "System", q: "actor=system" },
];

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const params = await searchParams;
  const actor = typeof params.actor === "string" && ["user", "agent", "system"].includes(params.actor) ? params.actor : undefined;
  const entity = typeof params.entity === "string" && /^[a-z_]{1,40}$/.test(params.entity) ? params.entity : undefined;
  const logs = await listAudit(ctx, { limit: 200, actorType: actor, entity });
  const current = actor ? `actor=${actor}` : entity ? `entity=${entity}` : "";

  return (
    <>
      <PageHeader title="Audit Log" subtitle="Append-only record. Row changes are captured by database triggers and cannot be edited or deleted." />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.label} href={`/audit${f.q ? `?${f.q}` : ""}`} className={cn("rounded-full border px-3 py-1 text-xs", current === f.q ? "border-gold text-gold" : "border-line text-muted hover:text-white")}>{f.label}</Link>
        ))}
      </div>
      <Card>
        <Table head={["When", "Actor", "Action", "Entity", "Details"]}>
          {logs.map((l) => (
            <tr key={l.id}>
              <Td className="text-xs whitespace-nowrap text-muted">{formatDateTime(l.created_at)}</Td>
              <Td><Badge tone={l.actor_type === "agent" ? "gold" : l.actor_type === "system" ? "neutral" : "info"}>{l.actor_type}</Badge></Td>
              <Td>{humanize(l.action)}</Td>
              <Td className="text-xs">{l.entity}</Td>
              <Td>
                <details className="text-xs"><summary className="cursor-pointer text-gold">View</summary>
                  <pre className="mt-1 max-h-60 max-w-md overflow-auto rounded bg-ink/60 p-2 text-slate-300">{JSON.stringify(l.metadata, null, 2)}</pre>
                </details>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
