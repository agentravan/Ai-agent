-- AI Empire OS — Project Apex: $100B North Star (USD), Legal Head, Board Meetings with the Founder.

-- ───────────────────────────── North Star in US dollars. Profit stays in INR; the Founder sets the USD→INR rate.
-- north_star_target_cents (INR paise) remains the single value every module reads; a trigger keeps it in sync.
alter table public.organisations
  add column north_star_usd bigint not null default 100000000000 check (north_star_usd between 1 and 500000000000), -- $100 billion
  add column usd_inr_rate numeric(8, 2) not null default 95 check (usd_inr_rate between 1 and 150);

create function private.sync_north_star() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.north_star_target_cents := round(new.north_star_usd * new.usd_inr_rate * 100)::bigint;
  return new;
end $$;
revoke all on function private.sync_north_star() from public, anon, authenticated;
create trigger organisations_sync_north_star before insert or update of north_star_usd, usd_inr_rate, north_star_target_cents
  on public.organisations for each row execute function private.sync_north_star();

update public.organisations set north_star_usd = 100000000000;

-- ───────────────────────────── Legal Head joins the C-suite (reports to the CEO).
create function private.seed_board(org uuid) returns void
language plpgsql set search_path = '' as $$
begin
  insert into public.agents (organisation_id, name, designation, tier, department_id, manager_id, instructions)
  select org, 'Themis', 'Chief Legal & Compliance Officer', 'executive',
         (select id from public.departments where organisation_id = org and name = 'Executive Office'),
         (select id from public.agents where organisation_id = org and tier = 'ceo'),
         'You are the AI Legal Head. Keep every business model, contract, outreach campaign and use of data lawful in India and in the client''s country: '
         || 'Indian Contract Act basics, GST invoicing, the IT Act and the Digital Personal Data Protection Act 2023, consumer protection, '
         || 'and for foreign outreach anti-spam rules (CAN-SPAM, GDPR consent, honouring opt-outs). '
         || 'For each plan say plainly: allowed / allowed with conditions / not allowed, and why, in simple words. '
         || 'Draft simple client agreements, privacy notices and terms for Founder review. '
         || 'You are not a lawyer: for disputes, licences, tax filings or anything binding and high-value, tell the Founder to confirm with a qualified professional. '
         || 'Never approve anything yourself; raise approval requests for anything risky.'
  on conflict (organisation_id, name) do nothing;

  insert into public.agent_permissions (organisation_id, agent_id, permission)
  select org, a.id, p from public.agents a
   cross join unnest(array['ai.execute', 'tasks.create', 'approvals.request', 'reports.create']) as p
   where a.organisation_id = org and a.name = 'Themis'
  on conflict do nothing;
end $$;
revoke all on function private.seed_board(uuid) from public, anon, authenticated;

create function private.seed_new_founder_board() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_board(p.organisation_id) from public.profiles p where p.id = new.id;
  return new;
end $$;
revoke all on function private.seed_new_founder_board() from public, anon, authenticated;
create trigger on_auth_user_created_seed_board after insert on auth.users
  for each row execute function private.seed_new_founder_board();

select private.seed_board(id) from public.organisations;

-- ───────────────────────────── Board meetings: Founder sets the topic, each C-suite member speaks, the CEO closes with a plan.
create table public.board_meetings (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  topic             text not null check (length(topic) between 3 and 2000),
  status            text not null default 'in_progress' check (status in ('in_progress', 'done', 'failed')),
  summary           text check (length(summary) <= 4000),
  plan_execution_id uuid references public.agent_executions (id) on delete set null,
  error             text check (length(error) <= 500),
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organisation_id, id)
);
create index board_meetings_recent_idx on public.board_meetings (organisation_id, created_at desc);

create table public.board_messages (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  meeting_id      uuid not null,
  seq             smallint not null check (seq between 0 and 50),
  agent_id        uuid,
  speaker         text not null check (length(speaker) between 1 and 160),
  body            text not null check (length(body) between 1 and 6000),
  failed          boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (meeting_id, seq),
  foreign key (organisation_id, meeting_id) references public.board_meetings (organisation_id, id) on delete cascade,
  foreign key (organisation_id, agent_id) references public.agents (organisation_id, id) on delete set null (agent_id)
);

do $$
declare t text;
begin
  execute 'create trigger board_meetings_touch before update on public.board_meetings for each row execute function public.touch_updated_at()';
  foreach t in array array['board_meetings', 'board_messages'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function private.audit_row_change()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (organisation_id = (select private.auth_org_id()))', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (organisation_id = (select private.auth_org_id()) and private.auth_can_write(false))', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(false)) with check (organisation_id = (select private.auth_org_id()))', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(true))', t, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
