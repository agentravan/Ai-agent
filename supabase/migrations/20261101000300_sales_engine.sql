-- AI Empire OS — Sales & Outreach Engine (Cabin D), CFO invoices, prospecting targets.

-- ───────────────────────────── Prospecting targets (what the engine hunts for, daily)
create table public.prospect_targets (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  category        text not null check (category ~ '^[a-z_]{2,40}$'),
  city            text not null check (length(city) between 2 and 120),
  country         text not null default 'United States' check (length(country) between 2 and 80),
  offer           text not null default 'website' check (offer in ('website', 'hr_services', 'ecommerce')),
  active          boolean not null default true,
  last_run_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, category, city, country, offer)
);

-- ───────────────────────────── Leads
create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  target_id        uuid references public.prospect_targets (id) on delete set null,
  business_unit_id uuid,
  name             text not null check (length(name) between 1 and 200),
  category         text not null default 'other' check (length(category) <= 40),
  city             text check (length(city) <= 120),
  country          text check (length(country) <= 80),
  address          text check (length(address) <= 300),
  phone            text check (length(phone) <= 40),
  email            text check (length(email) <= 200),
  website          text check (length(website) <= 300),
  instagram        text check (length(instagram) <= 200),
  source           text not null default 'manual' check (source in ('openstreetmap', 'manual')),
  source_ref       text check (length(source_ref) <= 80),
  score            smallint not null default 0 check (score between 0 and 100),
  status           text not null default 'new'
                   check (status in ('new', 'qualified', 'disqualified', 'pitch_ready', 'approved', 'contacted', 'replied', 'won', 'lost')),
  ai_reason        text check (length(ai_reason) <= 1000),
  pitch_subject    text check (length(pitch_subject) <= 200),
  pitch_email      text check (length(pitch_email) <= 4000),
  pitch_whatsapp   text check (length(pitch_whatsapp) <= 1000),
  approved_by      uuid references auth.users (id) on delete set null,
  contacted_at     timestamptz,
  contact_channel  text check (contact_channel in ('email', 'whatsapp', 'phone', 'other')),
  outcome_note     text check (length(outcome_note) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, source, source_ref),
  foreign key (organisation_id, business_unit_id) references public.business_units (organisation_id, id) on delete set null (business_unit_id)
);
create index leads_status_idx on public.leads (organisation_id, status, score desc);
create index leads_created_idx on public.leads (organisation_id, created_at desc);

-- ───────────────────────────── Invoices (CFO desk: outstanding dues)
create table public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  number              text not null check (length(number) between 1 and 40),
  client_name         text not null check (length(client_name) between 1 and 200),
  client_id           uuid,
  business_unit_id    uuid,
  amount_cents        bigint not null check (amount_cents > 0),
  currency            char(3) not null default 'INR',
  issued_on           date not null default current_date,
  due_on              date not null,
  status              text not null default 'sent' check (status in ('draft', 'sent', 'paid', 'void')),
  paid_on             date,
  financial_record_id uuid references public.financial_records (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organisation_id, number),
  check (due_on >= issued_on),
  check ((status = 'paid') = (paid_on is not null)),
  foreign key (organisation_id, client_id) references public.clients (organisation_id, id) on delete set null (client_id),
  foreign key (organisation_id, business_unit_id) references public.business_units (organisation_id, id) on delete set null (business_unit_id)
);
create index invoices_status_idx on public.invoices (organisation_id, status, due_on);

-- ───────────────────────────── Triggers + RLS
do $$
declare t text; gov boolean;
begin
  for t, gov in select * from (values ('prospect_targets', false), ('leads', false), ('invoices', true)) v(t, gov) loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function private.audit_row_change()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (organisation_id = (select private.auth_org_id()))', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (organisation_id = (select private.auth_org_id()) and private.auth_can_write(%L))', t, t, gov);
    execute format('create policy %I_update on public.%I for update to authenticated using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(%L)) with check (organisation_id = (select private.auth_org_id()))', t, t, gov);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(true))', t, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Approving outreach (external client communication) is a Founder/admin decision, enforced in the database.
create function private.guard_lead_approval() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- No session (e.g. background jobs) can never approve: approval is always a human decision.
  if new.status = 'approved' and old.status is distinct from 'approved' and not private.auth_can_write(true) then
    raise exception 'only the founder or an admin can approve outreach' using errcode = 'insufficient_privilege';
  end if;
  if new.status = 'contacted' and old.status is distinct from 'contacted' and old.status <> 'approved' then
    raise exception 'outreach must be approved before contact' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.guard_lead_approval() from public, anon, authenticated;
create trigger leads_guard_approval before update on public.leads for each row execute function private.guard_lead_approval();

-- ───────────────────────────── Seed: Cabin D unit, manager, KRAs (idempotent)
create function private.seed_sales_engine(org uuid) returns void
language plpgsql set search_path = '' as $$
declare growth uuid; ceo uuid;
begin
  select id into growth from public.departments where organisation_id = org and name = 'Growth';
  select id into ceo from public.agents where organisation_id = org and tier = 'ceo';

  insert into public.business_units (organisation_id, department_id, name, description)
  values (org, growth, 'Sales & Social Media Engine', 'Lead discovery, qualification, outreach drafting, social media and client conversion')
  on conflict (organisation_id, name) do nothing;

  insert into public.agents (organisation_id, name, designation, tier, department_id, manager_id, business_unit_id, instructions)
  select org, 'Iris', 'Sales & Outreach Manager', 'manager', growth,
         (select id from public.agents where organisation_id = org and name = 'Nova'), bu.id,
         'You run the sales engine: qualify leads, decide who is worth pitching and why, and write short, personal, honest pitches. '
         || 'Never invent facts about a business. Never send anything yourself: every outreach is approved by the Founder first. '
         || 'Learn from recorded outcomes (replied/won/lost) and prefer segments that convert.'
         || E'\nHierarchy: you are a Team Manager (Tier 2). Resolve routine issues yourself; the Founder is involved only for approvals of outreach, budget breaches or policy changes. Tie every action to a KRA.'
    from public.business_units bu where bu.organisation_id = org and bu.name = 'Sales & Social Media Engine'
  on conflict (organisation_id, name) do nothing;

  update public.business_units bu set manager_agent_id = a.id
    from public.agents a
   where bu.organisation_id = org and bu.name = 'Sales & Social Media Engine' and bu.manager_agent_id is null
     and a.organisation_id = org and a.name = 'Iris';

  insert into public.agent_permissions (organisation_id, agent_id, permission)
  select org, a.id, p from public.agents a
   cross join unnest(array['ai.execute', 'tasks.create', 'approvals.request', 'reports.create', 'leads.qualify', 'outreach.draft']) as p
   where a.organisation_id = org and a.name in ('Iris', 'Nova')
  on conflict do nothing;

  insert into public.kras (organisation_id, business_unit_id, name, description)
  select org, bu.id, v.name, v.description
    from (values ('Lead generation', 'Find and qualify prospects that fit our services'),
                 ('Lead conversion', 'Turn approved pitches into replies and paying clients')) as v(name, description)
    join public.business_units bu on bu.organisation_id = org and bu.name = 'Sales & Social Media Engine'
  on conflict (organisation_id, name) do nothing;
end $$;
revoke all on function private.seed_sales_engine(uuid) from public, anon, authenticated;

create function private.seed_new_founder_sales() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_sales_engine(p.organisation_id) from public.profiles p where p.id = new.id;
  return new;
end $$;
revoke all on function private.seed_new_founder_sales() from public, anon, authenticated;
-- Name sorts after on_auth_user_created_seed, so the Growth department and Nova already exist.
create trigger on_auth_user_created_seed_sales after insert on auth.users
  for each row execute function private.seed_new_founder_sales();

select private.seed_sales_engine(id) from public.organisations;
