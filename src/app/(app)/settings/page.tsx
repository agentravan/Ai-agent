import { AiStatusPanel } from "@/components/dashboard/ai-status";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { aiStatus, configuredProviders } from "@/lib/ai/registry";
import { env, founderAllowlist } from "@/lib/env";
import { CAPABILITIES } from "@/lib/permissions";
import { humanize } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import type { Department } from "@/types/domain";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireContext();
  const [ai, { data: departments }] = await Promise.all([aiStatus(), ctx.db.from("departments").select("id, name, description").order("name").returns<Department[]>()]);
  const providers = configuredProviders();
  const allow = founderAllowlist();

  return (
    <>
      <PageHeader eyebrow="System" title="Settings" subtitle="Organisation, access control and integration status. Secrets are configured as environment variables, never in the browser." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Organisation">
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <dt className="text-muted">Name</dt><dd className="col-span-2">{ctx.organisation.name}</dd>
            <dt className="text-muted">Your role</dt><dd className="col-span-2"><Badge tone="gold">{ctx.profile.role}</Badge></dd>
            <dt className="text-muted">Email</dt><dd className="col-span-2 truncate">{ctx.email}</dd>
            <dt className="text-muted">Founder allowlist</dt><dd className="col-span-2">{allow ? `${allow.size} email(s)` : "Not set (any Supabase user may sign up)"}</dd>
          </dl>
        </Card>
        <Card title="AI providers">
          <AiStatusPanel status={ai} />
          <ul className="mt-4 space-y-1 text-sm">
            {(["ollama", "openai-compatible", "anthropic"] as const).map((id) => {
              const p = providers.find((x) => x.id === id);
              return <li key={id} className="flex justify-between"><span>{humanize(id)}</span>{p ? <Badge tone="good">configured</Badge> : <Badge tone="neutral">pending</Badge>}</li>;
            })}
          </ul>
          <p className="mt-3 text-xs text-muted">Selection: {env.AI_PROVIDER ?? "first configured (free providers first)"} · timeout {env.AI_TIMEOUT_MS / 1000}s · max {env.AI_MAX_ATTEMPTS} attempts</p>
        </Card>
        <Card title="Role permissions">
          <Table head={["Capability", "Roles"]}>
            {Object.entries(CAPABILITIES).map(([cap, roles]) => (
              <tr key={cap}><Td>{humanize(cap)}</Td><Td className="text-xs text-muted">{roles.join(", ")}</Td></tr>
            ))}
          </Table>
        </Card>
        <Card title="Departments">
          <ul className="divide-y divide-line text-sm">
            {(departments ?? []).map((d) => <li key={d.id} className="py-2"><div className="text-zinc-50">{d.name}</div><div className="text-xs text-muted">{d.description}</div></li>)}
          </ul>
        </Card>
      </div>
    </>
  );
}
