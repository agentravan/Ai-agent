-- AI Empire OS — Virtual Executive Office
-- Divisions, business units with accountable managers, KRA/KPI framework and unit-level finance tagging.

-- ───────────────────────────── KRAs & KPIs
create table public.kras (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  business_unit_id uuid,
  name             text not null check (length(name) between 1 and 120),
  description      text check (length(description) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, name),
  unique (organisation_id, id),
  foreign key (organisation_id, business_unit_id) references public.business_units (organisation_id, id) on delete set null (business_unit_id)
);
create index kras_unit_idx on public.kras (organisation_id, business_unit_id);

create table public.kpis (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  kra_id          uuid not null,
  name            text not null check (length(name) between 1 and 120),
  unit            text not null default '' check (length(unit) <= 20),
  target          numeric(14, 2) not null check (target > 0),
  current_value   numeric(14, 2) not null default 0 check (current_value >= 0),
  period          text not null default 'monthly' check (period in ('daily', 'weekly', 'monthly', 'quarterly')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, kra_id) references public.kras (organisation_id, id) on delete cascade
);
create index kpis_kra_idx on public.kpis (kra_id);

-- ───────────────────────────── Links to units and KRAs
alter table public.business_units add column manager_agent_id uuid;
alter table public.business_units add foreign key (organisation_id, manager_agent_id)
  references public.agents (organisation_id, id) on delete set null (manager_agent_id);
create index business_units_manager_idx on public.business_units (manager_agent_id);

alter table public.agents add column business_unit_id uuid;
alter table public.agents add foreign key (organisation_id, business_unit_id)
  references public.business_units (organisation_id, id) on delete set null (business_unit_id);
create index agents_unit_idx on public.agents (business_unit_id);

alter table public.projects add column kra_id uuid;
alter table public.projects add foreign key (organisation_id, kra_id)
  references public.kras (organisation_id, id) on delete set null (kra_id);
create index projects_kra_idx on public.projects (kra_id);
create index projects_unit_idx on public.projects (business_unit_id);

alter table public.tasks add column kra_id uuid;
alter table public.tasks add foreign key (organisation_id, kra_id)
  references public.kras (organisation_id, id) on delete set null (kra_id);
create index tasks_kra_idx on public.tasks (kra_id);

alter table public.clients add column business_unit_id uuid;
alter table public.clients add foreign key (organisation_id, business_unit_id)
  references public.business_units (organisation_id, id) on delete set null (business_unit_id);
create index clients_unit_idx on public.clients (organisation_id, business_unit_id, status);

alter table public.financial_records add column business_unit_id uuid;
alter table public.financial_records add foreign key (organisation_id, business_unit_id)
  references public.business_units (organisation_id, id) on delete set null (business_unit_id);
create index financial_records_unit_idx on public.financial_records (organisation_id, business_unit_id, occurred_on desc);

-- ───────────────────────────── Triggers + RLS for new tables
create trigger kras_touch before update on public.kras for each row execute function public.touch_updated_at();
create trigger kpis_touch before update on public.kpis for each row execute function public.touch_updated_at();
create trigger kras_audit after insert or update or delete on public.kras for each row execute function private.audit_row_change();
create trigger kpis_audit after insert or update or delete on public.kpis for each row execute function private.audit_row_change();

do $$
declare t text; gov boolean;
begin
  for t, gov in select * from (values ('kras', true), ('kpis', false)) v(t, gov) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (organisation_id = (select private.auth_org_id()))', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (organisation_id = (select private.auth_org_id()) and private.auth_can_write(%L))', t, t, gov);
    execute format('create policy %I_update on public.%I for update to authenticated using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(%L)) with check (organisation_id = (select private.auth_org_id()))', t, t, gov);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(true))', t, t);
  end loop;
end $$;
revoke all on public.kras, public.kpis from anon;

-- ───────────────────────────── Seed (idempotent): divisions, units, managers, KRAs
create function private.seed_executive_office(org uuid) returns void
language plpgsql set search_path = '' as $$
declare
  coo uuid; ops uuid; strat uuid; fin uuid; ledger uuid;
  hierarchy constant text := E'\nHierarchy: you are a Team Manager (Tier 2). Review your team''s daily output, set task-level KPIs and resolve routine issues yourself. Escalate to your division head only for blockers you cannot resolve; the Founder is involved only for budget breaches, critical decisions or policy changes. Tie every action to a KRA.';
begin
  -- Divisions (rename foundation names when present, else create).
  update public.departments set name = 'Executive & Strategy', description = 'Strategic growth, market expansion, new initiatives, vision and execution planning'
   where organisation_id = org and name = 'Executive Office'
     and not exists (select 1 from public.departments where organisation_id = org and name = 'Executive & Strategy');
  update public.departments set name = 'Finance & Accounts', description = 'Budgeting, inbound/outbound payments, cash flow, margin and expense approvals'
   where organisation_id = org and name = 'Finance'
     and not exists (select 1 from public.departments where organisation_id = org and name = 'Finance & Accounts');
  insert into public.departments (organisation_id, name, description) values
    (org, 'Executive & Strategy', 'Strategic growth, market expansion, new initiatives, vision and execution planning'),
    (org, 'Operations', 'Delivery, task execution and workforce management'),
    (org, 'Finance & Accounts', 'Budgeting, inbound/outbound payments, cash flow, margin and expense approvals')
  on conflict (organisation_id, name) do nothing;

  select id into strat from public.departments where organisation_id = org and name = 'Executive & Strategy';
  select id into ops   from public.departments where organisation_id = org and name = 'Operations';
  select id into fin   from public.departments where organisation_id = org and name = 'Finance & Accounts';
  select id into coo   from public.agents where organisation_id = org and tier = 'coo';
  select id into ledger from public.agents where organisation_id = org and name = 'Ledger';

  -- Business units.
  insert into public.business_units (organisation_id, department_id, name, description) values
    (org, ops, 'Web Development & Tech', 'Client onboarding, UI/UX, full-stack architecture, deployment, maintenance'),
    (org, ops, 'HR Services & Consulting', 'Client talent acquisition, compliance, payroll management, policy and culture'),
    (org, ops, 'Buyontime E-Commerce', 'Product catalog, order fulfilment, dual-tier subscriptions, vouchers and margin management')
  on conflict (organisation_id, name) do nothing;

  -- Team managers (Tier 2), reporting to the COO.
  insert into public.agents (organisation_id, name, designation, tier, department_id, manager_id, business_unit_id, instructions)
  select org, v.name, v.designation, 'manager', ops, coo, bu.id, v.instructions || hierarchy
    from (values
      ('Vega', 'Web Development Lead', 'Web Development & Tech',
       'You lead the website-making team: client onboarding, UI/UX, full-stack architecture, deployment and maintenance. Produce concrete delivery plans with milestones.'),
      ('Hera', 'HR Services Manager', 'HR Services & Consulting',
       'You manage HR services for clients: talent acquisition, compliance, payroll management, internal policy and culture. Flag compliance risks early.'),
      ('Mercury', 'E-Commerce Operations Manager', 'Buyontime E-Commerce',
       'You run Buyontime operations: product catalog, order fulfilment, dual-tier subscriptions, vouchers and margin management. Protect margins.')
    ) as v(name, designation, unit, instructions)
    join public.business_units bu on bu.organisation_id = org and bu.name = v.unit
  on conflict (organisation_id, name) do nothing;

  update public.business_units bu set manager_agent_id = a.id
    from public.agents a
   where bu.organisation_id = org and a.organisation_id = org and bu.manager_agent_id is null
     and a.business_unit_id = bu.id and a.tier = 'manager';

  -- Finance head sits in Finance & Accounts.
  update public.agents set department_id = fin, designation = 'Chief Financial Officer / Finance Head'
   where id = ledger and designation = 'Chief Financial Officer';

  insert into public.agent_permissions (organisation_id, agent_id, permission)
  select org, a.id, p from public.agents a
   cross join unnest(array['ai.execute', 'tasks.create', 'approvals.request', 'reports.create']) as p
   where a.organisation_id = org and a.tier = 'manager'
  on conflict do nothing;

  -- KRAs (names only: targets are the Founder's decision, never invented).
  insert into public.kras (organisation_id, business_unit_id, name, description)
  select org, bu.id, v.name, v.description
    from (values
      ('Strategic growth', null, 'New initiatives, market expansion and long-term vision'),
      ('Client acquisition', 'Web Development & Tech', 'Win new website and tech clients'),
      ('Project delivery', 'Web Development & Tech', 'Deliver client projects on time and to quality'),
      ('HR client contracts', 'HR Services & Consulting', 'Win and retain HR service contracts'),
      ('Compliance', 'HR Services & Consulting', 'Keep clients and the company compliant'),
      ('Sales & orders', 'Buyontime E-Commerce', 'Grow orders and revenue'),
      ('Margin health', 'Buyontime E-Commerce', 'Protect margins on vouchers and subscriptions'),
      ('Cash flow control', null, 'Budget discipline, payments and net profit')
    ) as v(name, unit, description)
    left join public.business_units bu on bu.organisation_id = org and bu.name = v.unit
  on conflict (organisation_id, name) do nothing;
end $$;
revoke all on function private.seed_executive_office(uuid) from public, anon, authenticated;

-- New founders: runs after on_auth_user_created (triggers fire in name order).
create function private.seed_new_founder() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_executive_office(p.organisation_id) from public.profiles p where p.id = new.id;
  return new;
end $$;
revoke all on function private.seed_new_founder() from public, anon, authenticated;
create trigger on_auth_user_created_seed after insert on auth.users
  for each row execute function private.seed_new_founder();

-- Existing organisations.
select private.seed_executive_office(id) from public.organisations;
