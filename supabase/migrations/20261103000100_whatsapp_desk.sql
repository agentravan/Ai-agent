-- WhatsApp Desk: the team chats with clients on the Founder's WhatsApp number through a self-hosted WAHA gateway.
-- Messages themselves stay in WhatsApp/WAHA; we keep only who opted out, first contacts (daily cap) and an audit of
-- what was sent. Sending is external communication: only the Founder or an admin may record (and so make) a send.

create table public.whatsapp_contacts (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  chat_id          text not null check (chat_id ~ '^[0-9]{8,15}@(c\.us|s\.whatsapp\.net)$'),
  lead_id          uuid,
  opted_out        boolean not null default false,
  opted_out_at     timestamptz,
  first_contact_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, chat_id),
  check (opted_out = (opted_out_at is not null)),
  foreign key (organisation_id, lead_id) references public.leads (organisation_id, id) on delete set null (lead_id)
);

create table public.whatsapp_sends (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  chat_id          text not null check (chat_id ~ '^[0-9]{8,15}@(c\.us|s\.whatsapp\.net)$'),
  body             text not null check (length(body) between 1 and 4000),
  kind             text not null check (kind in ('reply', 'first_contact')),
  drafted_by       uuid,
  sent_by          uuid references auth.users (id) on delete set null,
  wa_message_id    text check (length(wa_message_id) <= 200),
  created_at       timestamptz not null default now(),
  foreign key (organisation_id, drafted_by) references public.agents (organisation_id, id) on delete set null (drafted_by)
);
create index whatsapp_sends_day_idx on public.whatsapp_sends (organisation_id, kind, created_at desc);

create trigger whatsapp_contacts_touch before update on public.whatsapp_contacts for each row execute function public.touch_updated_at();
create trigger whatsapp_contacts_audit after insert or update or delete on public.whatsapp_contacts for each row execute function private.audit_row_change();
create trigger whatsapp_sends_audit after insert or update or delete on public.whatsapp_sends for each row execute function private.audit_row_change();

alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_sends enable row level security;

create policy whatsapp_contacts_read on public.whatsapp_contacts for select to authenticated using (organisation_id = (select private.auth_org_id()));
create policy whatsapp_contacts_insert on public.whatsapp_contacts for insert to authenticated
  with check (organisation_id = (select private.auth_org_id()) and private.auth_can_write(false));
create policy whatsapp_contacts_update on public.whatsapp_contacts for update to authenticated
  using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(false)) with check (organisation_id = (select private.auth_org_id()));
create policy whatsapp_contacts_delete on public.whatsapp_contacts for delete to authenticated
  using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(true));

-- Sends are an append-only audit trail, written only by the Founder/admin (who pressed Send).
create policy whatsapp_sends_read on public.whatsapp_sends for select to authenticated using (organisation_id = (select private.auth_org_id()));
create policy whatsapp_sends_insert on public.whatsapp_sends for insert to authenticated
  with check (organisation_id = (select private.auth_org_id()) and private.auth_can_write(true) and sent_by = auth.uid());

revoke all on public.whatsapp_contacts from anon;
revoke all on public.whatsapp_sends from anon;

-- An opt-out is permanent: once a contact asked to stop, it can't be switched back on.
create function private.guard_whatsapp_optout() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.opted_out and not new.opted_out then
    raise exception 'This contact asked not to be messaged; the opt-out is permanent' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.guard_whatsapp_optout() from public, anon, authenticated;
create trigger whatsapp_contacts_optout_guard before update on public.whatsapp_contacts for each row execute function private.guard_whatsapp_optout();
