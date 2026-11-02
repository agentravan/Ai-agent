import { Mail, MessageCircle, Radar, Sparkles, Target as TargetIcon, ThumbsUp, Users } from "lucide-react";
import { Badge, Card, Empty, Field, Flash, PageHeader, Select, Stat, Table, Td, type SearchParams } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { aiStatus } from "@/lib/ai/registry";
import { emailConfigured } from "@/lib/integrations/email";
import { googlePlacesConfigured } from "@/lib/integrations/google-places";
import { LEAD_CATEGORIES } from "@/lib/integrations/osm";
import { can } from "@/lib/permissions";
import { formatDateTime, humanize, truncate } from "@/lib/utilities/format";
import { requireContext } from "@/modules/auth/session";
import {
  addManualLeadAction, addTargetAction, approveAllAction, approveLeadAction, checkRepliesAction, discoverTargetAction, qualifyAction, recordOutcomeAction,
  rejectLeadAction, runCycleAction, sendEmailAction, toggleTargetAction, whatsappAction,
} from "@/modules/sales/actions";
import { learnFromOutcomes, mailtoLink, whatsappNumber } from "@/modules/sales/logic";
import type { Lead, Target } from "@/modules/sales/service";

export const metadata = { title: "Sales Engine" };
export const maxDuration = 300;

const CATEGORY_OPTIONS = Object.entries(LEAD_CATEGORIES).map(([value, c]) => ({ value, label: c.label }));
const SOURCE_LABEL: Record<string, string> = { openstreetmap: "OpenStreetMap", google_places: "Google Maps", manual: "Manual" };
const OFFER_OPTIONS = [{ value: "website", label: "Website + social media" }, { value: "hr_services", label: "HR services (ask what they need)" }, { value: "ecommerce", label: "E-commerce store" }];

function Pitch({ lead }: { lead: Lead }) {
  return (
    <details className="mt-2 rounded-md border border-line bg-panel-2/40 p-3 text-xs">
      <summary className="cursor-pointer font-medium text-zinc-300 hover:text-white">View drafted messages</summary>
      {lead.pitch_whatsapp && <><p className="mt-2 font-medium text-zinc-400">WhatsApp</p><p className="mt-1 whitespace-pre-wrap text-zinc-300">{lead.pitch_whatsapp}</p></>}
      {lead.pitch_email && <><p className="mt-3 font-medium text-zinc-400">Email · {lead.pitch_subject}</p><p className="mt-1 whitespace-pre-wrap text-zinc-300">{lead.pitch_email}</p></>}
    </details>
  );
}

const Contact = ({ lead }: { lead: Lead }) => (
  <div className="text-xs text-muted">
    {[lead.category && humanize(lead.category), lead.city, lead.phone && "📞 phone", lead.email && "✉ email", lead.instagram && "IG"].filter(Boolean).join(" · ")}
    {lead.address && <div className="truncate">{lead.address}</div>}
  </div>
);

export default async function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const org = ctx.organisation.id;
  const [params, ai, { data: targets }, { data: leads }] = await Promise.all([
    searchParams,
    aiStatus(),
    ctx.db.from("prospect_targets").select("*").eq("organisation_id", org).order("created_at").returns<Target[]>(),
    ctx.db.from("leads").select("*").eq("organisation_id", org).order("score", { ascending: false }).limit(1000).returns<Lead[]>(),
  ]);
  const L = leads ?? [];
  const by = (s: string) => L.filter((l) => l.status === s);
  const learning = learnFromOutcomes(L);
  const canOperate = can(ctx.profile.role, "operate");
  const canGovern = can(ctx.profile.role, "govern");
  const mail = emailConfigured();
  const awaiting = by("pitch_ready");
  const ready = by("approved");
  const inFlight = L.filter((l) => l.status === "contacted" || l.status === "replied");

  return (
    <>
      <PageHeader eyebrow="Cabin D · Sales & Social Media Engine" title="Sales Engine"
        subtitle="Iris finds real businesses, decides who is worth pitching and why, writes the messages, emails approved leads from your own mailbox and reads your inbox for replies. You only approve." />
      <Flash params={params} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={Users} label="Leads in pipeline" value={L.filter((l) => l.status !== "disqualified").length} hint={`${by("new").length} awaiting AI review`} />
        <Stat icon={Sparkles} label="Awaiting your approval" value={awaiting.length} />
        <Stat icon={MessageCircle} label="Ready to send" value={ready.length} />
        <Stat icon={Radar} label="Contacted" value={learning.contacted} hint={`${learning.replied} positive`} />
        <Stat icon={ThumbsUp} label="Won" value={learning.won} tone={learning.won ? "good" : undefined} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Hunting targets" description={googlePlacesConfigured() ? "The engine searches these daily and on demand (Google Places, with OpenStreetMap as backup)" : "The engine searches these daily and on demand (free OpenStreetMap data — add a Google Places key for more phone numbers)"} className="xl:col-span-2"
          action={canOperate && ai.available && (targets?.length ?? 0) > 0 && <form action={runCycleAction}><SubmitButton variant="ghost" pendingText="Hunting…">Run full cycle now</SubmitButton></form>}>
          {targets?.length ? (
            <ul className="divide-y divide-line">
              {targets.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <span className="font-medium text-zinc-100">{LEAD_CATEGORIES[t.category as keyof typeof LEAD_CATEGORIES]?.label ?? t.category}</span>
                    <span className="text-muted"> in {t.city}, {t.country} · offer: {humanize(t.offer)}</span>
                    <div className="text-xs text-zinc-500">Last run: {t.last_run_at ? formatDateTime(t.last_run_at) : "never"}</div>
                  </div>
                  {canOperate && (
                    <div className="flex gap-2">
                      <Badge tone={t.active ? "good" : "neutral"}>{t.active ? "daily on" : "paused"}</Badge>
                      <form action={discoverTargetAction}><input type="hidden" name="id" value={t.id} /><SubmitButton variant="ghost" pendingText="Searching…">Find leads</SubmitButton></form>
                      <form action={toggleTargetAction}><input type="hidden" name="id" value={t.id} /><button className="btn-ghost">{t.active ? "Pause" : "Resume"}</button></form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : <Empty icon={TargetIcon}>No targets yet. Add one below — e.g. Hair & beauty salons in Dallas.</Empty>}
          {canOperate && (
            <form action={addTargetAction} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-5">
              <Field label="Business type" className="sm:col-span-2"><Select name="category" options={CATEGORY_OPTIONS} defaultValue="salon" /></Field>
              <Field label="City"><input name="city" required maxLength={120} className="input" placeholder="Dallas" /></Field>
              <Field label="Country"><input name="country" maxLength={80} className="input" defaultValue="United States" /></Field>
              <Field label="Offer"><Select name="offer" options={OFFER_OPTIONS} defaultValue="website" /></Field>
              <div className="sm:col-span-5"><SubmitButton>Add target</SubmitButton></div>
            </form>
          )}
        </Card>

        <Card title="What the engine has learned" description="From outcomes you record (replied / won / lost)">
          <p className="text-sm text-zinc-300">{learning.summary}</p>
          {learning.segments.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-xs">
              {learning.segments.slice(0, 6).map((s) => (
                <li key={s.key} className="flex justify-between gap-2"><span className="text-muted">{s.key.replace(":", " · ")}</span><span className="num text-zinc-200">{s.rate}% ({s.positive}/{s.contacted})</span></li>
              ))}
            </ul>
          )}
          {canOperate && ai.available && by("new").length > 0 && (
            <form action={qualifyAction} className="mt-4 border-t border-line pt-4"><SubmitButton pendingText="Iris is reviewing…">Qualify {Math.min(8, by("new").length)} new leads with AI</SubmitButton></form>
          )}
          {!ai.available && <p className="mt-3 text-xs text-amber-300">AI unavailable — qualification paused.</p>}
        </Card>
      </div>

      <Card title={`Awaiting your approval (${awaiting.length})`} description="Iris recommends pitching these. Nothing is sent without your approval." className="mt-6"
        action={canGovern && awaiting.length > 1 && <form action={approveAllAction}><SubmitButton>Approve all {awaiting.length}</SubmitButton></form>}>
        {awaiting.length ? (
          <ul className="divide-y divide-line">
            {awaiting.map((l) => (
              <li key={l.id} className="py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className="font-medium text-zinc-100">{l.name}</span><Badge tone="gold">{`fit ${l.score}`}</Badge></div>
                    <Contact lead={l} />
                    <p className="mt-1 text-sm text-zinc-300">{l.ai_reason}</p>
                  </div>
                  {canGovern && (
                    <div className="flex shrink-0 gap-2">
                      <form action={approveLeadAction}><input type="hidden" name="id" value={l.id} /><SubmitButton>Approve</SubmitButton></form>
                      <form action={rejectLeadAction}><input type="hidden" name="id" value={l.id} /><button className="btn-ghost">Skip</button></form>
                    </div>
                  )}
                </div>
                <Pitch lead={l} />
              </li>
            ))}
          </ul>
        ) : <Empty>No pitches waiting. Run a cycle or qualify new leads.</Empty>}
      </Card>

      <Card title={`Ready to send (${ready.length})`} description={mail ? "Email pitches are sent by Iris automatically after approval (daily limit protects your mailbox). WhatsApp opens pre-written — just press send." : "Connect your mailbox so Iris can email approved leads herself. WhatsApp opens pre-written — just press send."} className="mt-6">
        {ready.length ? (
          <ul className="divide-y divide-line">
            {ready.map((l) => (
              <li key={l.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><div className="font-medium text-zinc-100">{l.name}</div><Contact lead={l} /></div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {whatsappNumber(l.phone, l.country) && l.pitch_whatsapp && (
                    <form action={whatsappAction}><input type="hidden" name="id" value={l.id} /><button className="btn-gold"><MessageCircle className="h-4 w-4" />WhatsApp</button></form>
                  )}
                  {l.email && l.pitch_email && (mail
                    ? <form action={sendEmailAction}><input type="hidden" name="id" value={l.id} /><SubmitButton variant="ghost" pendingText="Sending…"><Mail className="h-4 w-4" />Send now</SubmitButton></form>
                    : <a className="btn-ghost" href={mailtoLink(l.email, l.pitch_subject ?? "", l.pitch_email)}><Mail className="h-4 w-4" />Open email</a>)}
                  {!l.email && !whatsappNumber(l.phone, l.country) && <span className="text-xs text-amber-300">No usable contact — call {l.phone ?? "n/a"}</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : <Empty>Approved pitches appear here.</Empty>}
      </Card>

      <Card title={`Conversations (${inFlight.length})`} description={mail ? "Email replies are detected automatically from your inbox. Record WhatsApp outcomes here — this is how the engine learns." : "Record what happened — this is how the engine learns."} className="mt-6"
        action={canOperate && mail && <form action={checkRepliesAction}><SubmitButton variant="ghost" pendingText="Reading inbox…">Check replies now</SubmitButton></form>}>
        {inFlight.length ? (
          <Table head={["Business", "Channel", "Status", "Record outcome"]}>
            {inFlight.map((l) => (
              <tr key={l.id}>
                <Td><div className="text-zinc-50">{l.name}</div><div className="text-xs text-muted">{l.city}</div></Td>
                <Td className="text-xs">{l.contact_channel ?? "—"} · {formatDateTime(l.contacted_at)}</Td>
                <Td><Badge>{l.status}</Badge></Td>
                <Td>
                  {canOperate && (
                    <form action={recordOutcomeAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={l.id} />
                      <input name="note" maxLength={1000} placeholder="Note (optional)" className="input max-w-44" />
                      {l.status === "contacted" && <SubmitButton name="outcome" value="replied" variant="ghost">Replied</SubmitButton>}
                      <SubmitButton name="outcome" value="won">Won</SubmitButton>
                      <SubmitButton name="outcome" value="lost" variant="danger">Lost</SubmitButton>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        ) : <Empty>No active conversations yet.</Empty>}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title={`New leads (${by("new").length})`} description="Found by the engine, waiting for AI qualification" className="xl:col-span-2">
          {by("new").length ? (
            <Table head={["Business", "Fit", "Contact", "Source"]}>
              {by("new").slice(0, 50).map((l) => (
                <tr key={l.id}>
                  <Td><div className="text-zinc-50">{l.name}</div><div className="text-xs text-muted">{truncate(l.address, 60)}</div></Td>
                  <Td className="num">{l.score}</Td>
                  <Td className="text-xs text-muted">{[l.phone && "phone", l.email && "email", l.instagram && "instagram"].filter(Boolean).join(", ") || "none"}</Td>
                  <Td className="text-xs text-muted">{SOURCE_LABEL[l.source] ?? "Manual"}</Td>
                </tr>
              ))}
            </Table>
          ) : <Empty>No unreviewed leads.</Empty>}
          <p className="mt-3 text-xs text-zinc-500">{by("disqualified").length} leads skipped with reasons · Map data © OpenStreetMap contributors (ODbL){L.some((l) => l.source === "google_places") ? " · Business data from Google Maps" : ""}.</p>
        </Card>
        {canOperate && (
          <Card title="Add a lead manually" description="From Google Maps, Instagram or a referral">
            <form action={addManualLeadAction} className="grid gap-3">
              <Field label="Business name"><input name="name" required maxLength={200} className="input" /></Field>
              <Field label="Category"><Select name="category" options={CATEGORY_OPTIONS} defaultValue="salon" /></Field>
              <Field label="City"><input name="city" maxLength={120} className="input" /></Field>
              <Field label="Phone (with country code)"><input name="phone" maxLength={40} className="input" placeholder="+1 214 555 0100" /></Field>
              <Field label="Email"><input name="email" type="email" maxLength={200} className="input" /></Field>
              <Field label="Website (if any)"><input name="website" maxLength={300} className="input" /></Field>
              <div><SubmitButton>Add lead</SubmitButton></div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
