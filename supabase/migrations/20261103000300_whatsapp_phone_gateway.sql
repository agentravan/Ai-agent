-- Phone gateway: the WhatsApp link runs in Termux on the Founder's own phone. It only makes outgoing,
-- HMAC-signed requests: it reports its status, posts incoming messages, and collects queued replies.
-- No public server, no tunnel. Gateway rows are written by the server's verified endpoint (service role) only.

create table public.whatsapp_gateway (
  organisation_id uuid primary key references public.organisations (id) on delete cascade,
  status          text not null default 'offline' check (status in ('offline', 'connecting', 'pairing', 'connected', 'logged_out')),
  pairing_code    text check (pairing_code ~ '^[A-Z0-9-]{8,9}$'),
  me              text check (length(me) <= 40),
  last_seen       timestamptz not null default now()
);

create table public.whatsapp_outbox (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  chat_id         text not null check (chat_id ~ '^[0-9]{8,15}@c\.us$'),
  body            text not null check (length(body) between 1 and 4000),
  status          text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts        smallint not null default 0 check (attempts between 0 and 10),
  claimed_at      timestamptz,
  wa_message_id   text check (length(wa_message_id) <= 200),
  error           text check (length(error) <= 300),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index whatsapp_outbox_pending_idx on public.whatsapp_outbox (organisation_id, status, created_at);
create index whatsapp_outbox_chat_idx on public.whatsapp_outbox (organisation_id, chat_id, created_at desc);
create index whatsapp_inbound_chat_idx on public.whatsapp_inbound (organisation_id, chat_id, created_at desc);

create trigger whatsapp_outbox_audit after insert or update or delete on public.whatsapp_outbox for each row execute function private.audit_row_change();

alter table public.whatsapp_gateway enable row level security;
alter table public.whatsapp_outbox enable row level security;
create policy whatsapp_gateway_read on public.whatsapp_gateway for select to authenticated using (organisation_id = (select private.auth_org_id()));
create policy whatsapp_outbox_read on public.whatsapp_outbox for select to authenticated using (organisation_id = (select private.auth_org_id()));
-- Queuing a message is sending it: Founder/admin only (the auto-reply path runs on the server).
create policy whatsapp_outbox_insert on public.whatsapp_outbox for insert to authenticated
  with check (organisation_id = (select private.auth_org_id()) and private.auth_can_write(true) and status = 'pending' and created_by = auth.uid());
revoke all on public.whatsapp_gateway from anon;
revoke all on public.whatsapp_outbox from anon;
