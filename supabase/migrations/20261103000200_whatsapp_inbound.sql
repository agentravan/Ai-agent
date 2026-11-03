-- WhatsApp automation: every incoming message is handled exactly once (WAHA may retry a webhook).
-- Written only by the server's verified webhook (service role); the Founder's team can read it.
create table public.whatsapp_inbound (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  wa_message_id   text not null check (length(wa_message_id) between 1 and 200),
  chat_id         text not null check (chat_id ~ '^[0-9]{8,15}@(c\.us|s\.whatsapp\.net)$'),
  body            text check (length(body) <= 4000),
  handled         text not null default 'received'
                  check (handled in ('received', 'auto_sent', 'needs_approval', 'opted_out', 'skipped', 'failed')),
  note            text check (length(note) <= 500),
  approval_id     uuid references public.approvals (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organisation_id, wa_message_id)
);
create index whatsapp_inbound_recent_idx on public.whatsapp_inbound (organisation_id, created_at desc);
create trigger whatsapp_inbound_audit after insert or update or delete on public.whatsapp_inbound for each row execute function private.audit_row_change();
alter table public.whatsapp_inbound enable row level security;
create policy whatsapp_inbound_read on public.whatsapp_inbound for select to authenticated using (organisation_id = (select private.auth_org_id()));
revoke all on public.whatsapp_inbound from anon;
