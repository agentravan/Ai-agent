-- AI Empire OS — foundation schema
-- Multi-tenant: every business row carries organisation_id. Tenant integrity is enforced twice:
--   1. Composite foreign keys (organisation_id, x_id) make cross-organisation references impossible.
--   2. Row Level Security scopes every read/write to the caller's organisation and role.

create extension if not exists pgcrypto;

-- ───────────────────────────── Enums
create type public.app_role         as enum ('founder', 'admin', 'member', 'viewer');
create type public.agent_tier       as enum ('ceo', 'coo', 'executive', 'manager', 'worker');
create type public.agent_status     as enum ('active', 'suspended');
create type public.project_status   as enum ('planned', 'active', 'on_hold', 'completed', 'cancelled');
create type public.task_status      as enum ('todo', 'in_progress', 'blocked', 'done', 'failed', 'cancelled');
create type public.priority_level   as enum ('low', 'medium', 'high', 'critical');
create type public.execution_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type public.approval_status  as enum ('pending', 'approved', 'rejected');
create type public.opportunity_status as enum ('proposed', 'evaluating', 'approved', 'rejected', 'won', 'lost');

-- ───────────────────────────── Shared trigger: updated_at
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- ───────────────────────────── Core identity
create table public.organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  email           text not null,
  full_name       text check (length(full_name) <= 120),
  role            public.app_role not null default 'viewer',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index profiles_org_idx on public.profiles (organisation_id);

-- Caller context helpers (SECURITY DEFINER avoids RLS recursion on profiles).
create function public.auth_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select organisation_id from public.profiles where id = auth.uid()
$$;
create function public.auth_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;
create function public.auth_can_write(governance boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case when governance then role in ('founder', 'admin')
                 else role in ('founder', 'admin', 'member') end
       from public.profiles where id = auth.uid()),
    false)
$$;

-- ───────────────────────────── Structure
create table public.departments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name            text not null check (length(name) between 1 and 80),
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, name),
  unique (organisation_id, id)
);

create table public.business_units (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  department_id   uuid,
  name            text not null check (length(name) between 1 and 80),
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, name),
  unique (organisation_id, id),
  foreign key (organisation_id, department_id) references public.departments (organisation_id, id) on delete set null (department_id)
);

-- ───────────────────────────── Agents
create table public.agents (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null references public.organisations (id) on delete cascade,
  name                      text not null check (length(name) between 1 and 80),
  designation               text not null check (length(designation) between 1 and 120),
  tier                      public.agent_tier not null default 'worker',
  instructions              text not null default '' check (length(instructions) <= 8000),
  department_id             uuid,
  manager_id                uuid,
  status                    public.agent_status not null default 'active',
  monthly_cost_limit_cents  integer not null default 0 check (monthly_cost_limit_cents >= 0),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (organisation_id, name),
  unique (organisation_id, id),
  check (manager_id is null or manager_id <> id),
  foreign key (organisation_id, department_id) references public.departments (organisation_id, id) on delete set null (department_id),
  foreign key (organisation_id, manager_id)    references public.agents (organisation_id, id) on delete set null (manager_id)
);
create index agents_org_status_idx on public.agents (organisation_id, status);
create index agents_manager_idx on public.agents (manager_id);
-- Exactly one CEO and one COO per organisation.
create unique index agents_one_ceo_idx on public.agents (organisation_id) where tier = 'ceo';
create unique index agents_one_coo_idx on public.agents (organisation_id) where tier = 'coo';

create table public.agent_permissions (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  agent_id        uuid not null,
  permission      text not null check (permission ~ '^[a-z_]+\.[a-z_]+$'),
  created_at      timestamptz not null default now(),
  primary key (agent_id, permission),
  foreign key (organisation_id, agent_id) references public.agents (organisation_id, id) on delete cascade
);
create index agent_permissions_org_idx on public.agent_permissions (organisation_id);

create table public.agent_memories (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  agent_id        uuid not null,
  kind            text not null default 'note' check (kind in ('note', 'fact', 'decision', 'summary')),
  content         text not null check (length(content) between 1 and 8000),
  importance      smallint not null default 3 check (importance between 1 and 5),
  created_at      timestamptz not null default now(),
  foreign key (organisation_id, agent_id) references public.agents (organisation_id, id) on delete cascade
);
create index agent_memories_agent_idx on public.agent_memories (agent_id, created_at desc);

-- ───────────────────────────── Work
create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  name             text not null check (length(name) between 1 and 120),
  description      text,
  status           public.project_status not null default 'planned',
  owner_agent_id   uuid,
  business_unit_id uuid,
  due_date         date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, owner_agent_id)   references public.agents (organisation_id, id) on delete set null (owner_agent_id),
  foreign key (organisation_id, business_unit_id) references public.business_units (organisation_id, id) on delete set null (business_unit_id)
);
create index projects_org_status_idx on public.projects (organisation_id, status);

create table public.tasks (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  project_id        uuid,
  title             text not null check (length(title) between 1 and 200),
  description       text check (length(description) <= 8000),
  status            public.task_status not null default 'todo',
  priority          public.priority_level not null default 'medium',
  assigned_agent_id uuid,
  created_by        uuid references auth.users (id) on delete set null,
  result            text,
  due_date          date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, project_id)        references public.projects (organisation_id, id) on delete cascade,
  foreign key (organisation_id, assigned_agent_id) references public.agents (organisation_id, id) on delete set null (assigned_agent_id)
);
create index tasks_org_status_idx on public.tasks (organisation_id, status);
create index tasks_agent_idx on public.tasks (assigned_agent_id, status);
create index tasks_project_idx on public.tasks (project_id);

create table public.task_dependencies (
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  task_id            uuid not null,
  depends_on_task_id uuid not null,
  created_at         timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id),
  foreign key (organisation_id, task_id)            references public.tasks (organisation_id, id) on delete cascade,
  foreign key (organisation_id, depends_on_task_id) references public.tasks (organisation_id, id) on delete cascade
);
create index task_dependencies_dep_idx on public.task_dependencies (depends_on_task_id);

-- Reject dependency cycles.
create function public.prevent_task_cycle() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    with recursive chain(id) as (
      select new.depends_on_task_id
      union
      select d.depends_on_task_id from public.task_dependencies d join chain c on d.task_id = c.id
    ) select 1 from chain where id = new.task_id
  ) then
    raise exception 'task dependency cycle detected' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger task_dependencies_no_cycle before insert or update on public.task_dependencies
  for each row execute function public.prevent_task_cycle();

create table public.agent_executions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  agent_id        uuid,
  task_id         uuid,
  kind            text not null check (kind in ('task', 'command', 'chat')),
  status          public.execution_status not null default 'queued',
  input           text not null check (length(input) <= 16000),
  output          text,
  plan            jsonb,
  error           text,
  attempts        smallint not null default 0 check (attempts >= 0),
  max_attempts    smallint not null default 3 check (max_attempts between 1 and 10),
  provider        text,
  model           text,
  input_tokens    integer not null default 0 check (input_tokens >= 0),
  output_tokens   integer not null default 0 check (output_tokens >= 0),
  cost_cents      numeric(12, 4) not null default 0 check (cost_cents >= 0),
  triggered_by    uuid references auth.users (id) on delete set null,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (attempts <= max_attempts),
  foreign key (organisation_id, agent_id) references public.agents (organisation_id, id) on delete set null (agent_id),
  foreign key (organisation_id, task_id)  references public.tasks (organisation_id, id) on delete set null (task_id)
);
create index agent_executions_org_created_idx on public.agent_executions (organisation_id, created_at desc);
create index agent_executions_agent_month_idx on public.agent_executions (agent_id, created_at);
create index agent_executions_task_idx on public.agent_executions (task_id);

-- ───────────────────────────── Growth & governance
create table public.opportunities (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  title                 text not null check (length(title) between 1 and 200),
  summary               text check (length(summary) <= 8000),
  status                public.opportunity_status not null default 'proposed',
  estimated_value_cents bigint check (estimated_value_cents >= 0),
  proposed_by_agent_id  uuid,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  foreign key (organisation_id, proposed_by_agent_id) references public.agents (organisation_id, id) on delete set null (proposed_by_agent_id)
);
create index opportunities_org_status_idx on public.opportunities (organisation_id, status);

create table public.approvals (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  title                 text not null check (length(title) between 1 and 200),
  action_type           text not null check (action_type ~ '^[a-z_]+\.[a-z_]+$'),
  payload               jsonb not null default '{}'::jsonb,
  risk                  public.priority_level not null default 'medium',
  status                public.approval_status not null default 'pending',
  requested_by_agent_id uuid,
  requested_by          uuid references auth.users (id) on delete set null,
  decided_by            uuid references auth.users (id) on delete set null,
  decided_at            timestamptz,
  decision_note         text check (length(decision_note) <= 2000),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null)),
  foreign key (organisation_id, requested_by_agent_id) references public.agents (organisation_id, id) on delete set null (requested_by_agent_id)
);
create index approvals_org_status_idx on public.approvals (organisation_id, status, created_at desc);

-- Decisions are final: a decided approval cannot be re-decided.
create function public.lock_decided_approval() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'pending' then
    raise exception 'approval already decided' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger approvals_lock before update on public.approvals
  for each row execute function public.lock_decided_approval();

-- ───────────────────────────── CRM, people, finance
create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name            text not null check (length(name) between 1 and 160),
  email           text,
  phone           text,
  status          text not null default 'lead' check (status in ('lead', 'active', 'churned')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, id)
);
create index clients_org_idx on public.clients (organisation_id, status);

create table public.employees (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  full_name           text not null check (length(full_name) between 1 and 160),
  email               text,
  designation         text,
  department_id       uuid,
  manager_employee_id uuid,
  status              text not null default 'active' check (status in ('active', 'inactive')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organisation_id, id),
  check (manager_employee_id is null or manager_employee_id <> id),
  foreign key (organisation_id, department_id)       references public.departments (organisation_id, id) on delete set null (department_id),
  foreign key (organisation_id, manager_employee_id) references public.employees (organisation_id, id) on delete set null (manager_employee_id)
);
create index employees_org_idx on public.employees (organisation_id);

create table public.budgets (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name            text not null check (length(name) between 1 and 120),
  department_id   uuid,
  period_start    date not null,
  period_end      date not null,
  amount_cents    bigint not null check (amount_cents >= 0),
  currency        char(3) not null default 'INR',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, id),
  check (period_end >= period_start),
  foreign key (organisation_id, department_id) references public.departments (organisation_id, id) on delete set null (department_id)
);
create index budgets_org_idx on public.budgets (organisation_id, period_start);

create table public.financial_records (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  budget_id       uuid,
  client_id       uuid,
  kind            text not null check (kind in ('income', 'expense')),
  amount_cents    bigint not null check (amount_cents > 0),
  currency        char(3) not null default 'INR',
  occurred_on     date not null default current_date,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (organisation_id, budget_id) references public.budgets (organisation_id, id) on delete set null (budget_id),
  foreign key (organisation_id, client_id) references public.clients (organisation_id, id) on delete set null (client_id)
);
create index financial_records_org_idx on public.financial_records (organisation_id, occurred_on desc);

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete cascade,
  title           text not null check (length(title) between 1 and 200),
  body            text,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (organisation_id, user_id, read_at);

create table public.scheduled_jobs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name            text not null check (length(name) between 1 and 120),
  cron            text not null check (cron ~ '^(\S+\s+){4}\S+$'),
  agent_id        uuid,
  prompt          text not null check (length(prompt) <= 8000),
  enabled         boolean not null default false,
  last_run_at     timestamptz,
  next_run_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (organisation_id, agent_id) references public.agents (organisation_id, id) on delete cascade
);
create index scheduled_jobs_due_idx on public.scheduled_jobs (enabled, next_run_at);

-- ───────────────────────────── Audit (append-only)
create table public.audit_logs (
  id              bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  actor_type      text not null check (actor_type in ('user', 'agent', 'system')),
  actor_id        uuid,
  action          text not null check (length(action) between 1 and 80),
  entity          text not null check (length(entity) between 1 and 80),
  entity_id       text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organisation_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (organisation_id, entity, entity_id);

-- Row-change audit trail that application code cannot skip.
create function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rec record := coalesce(new, old);
begin
  -- Skip rows removed by an organisation-level cascade (nothing left to attribute them to).
  if tg_op = 'DELETE' and not exists (select 1 from public.organisations where id = rec.organisation_id) then
    return null;
  end if;
  insert into public.audit_logs (organisation_id, actor_type, actor_id, action, entity, entity_id, metadata)
  values (
    rec.organisation_id,
    case when auth.uid() is null then 'system' else 'user' end,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    case when tg_table_name = 'agent_permissions' then (to_jsonb(rec) ->> 'agent_id') else (to_jsonb(rec) ->> 'id') end,
    case tg_op
      when 'UPDATE' then jsonb_build_object('changed', (
        select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb)
          from jsonb_each(to_jsonb(new)) n
         where n.key not in ('updated_at') and n.value is distinct from (to_jsonb(old) -> n.key)))
      when 'DELETE' then jsonb_build_object('deleted', to_jsonb(old))
      else jsonb_build_object('created', to_jsonb(new))
    end
  );
  return null;
end $$;

-- ───────────────────────────── Triggers: updated_at + audit
do $$
declare t text;
begin
  foreach t in array array['organisations','profiles','departments','business_units','agents','projects','tasks',
    'agent_executions','opportunities','approvals','clients','employees','budgets','financial_records','scheduled_jobs']
  loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['departments','agents','agent_permissions','projects','tasks','opportunities','approvals',
    'clients','employees','budgets','financial_records','scheduled_jobs']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
  end loop;
end $$;

-- ───────────────────────────── Row Level Security
alter table public.organisations enable row level security;
alter table public.profiles      enable row level security;

create policy org_read   on public.organisations for select to authenticated using (id = (select public.auth_org_id()));
create policy org_update on public.organisations for update to authenticated
  using (id = (select public.auth_org_id()) and (select public.auth_role()) = 'founder') with check (id = (select public.auth_org_id()));

create policy profiles_read on public.profiles for select to authenticated using (organisation_id = (select public.auth_org_id()));
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Only the display name is user-editable; role/org changes require a privileged path.
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

do $$
declare t text; gov boolean;
begin
  for t, gov in select * from (values
    ('departments', true), ('business_units', true), ('agents', true), ('agent_permissions', true),
    ('employees', true), ('budgets', true), ('financial_records', true), ('scheduled_jobs', true),
    ('agent_memories', false), ('projects', false), ('tasks', false), ('task_dependencies', false),
    ('agent_executions', false), ('opportunities', false), ('clients', false)) v(t, gov)
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (organisation_id = (select public.auth_org_id()))', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (organisation_id = (select public.auth_org_id()) and public.auth_can_write(%L))', t, t, gov);
    execute format('create policy %I_update on public.%I for update to authenticated using (organisation_id = (select public.auth_org_id()) and public.auth_can_write(%L)) with check (organisation_id = (select public.auth_org_id()))', t, t, gov);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (organisation_id = (select public.auth_org_id()) and public.auth_can_write(true))', t, t);
  end loop;
end $$;

-- Approvals: members may request; only founder/admin decide; nobody deletes.
alter table public.approvals enable row level security;
create policy approvals_read on public.approvals for select to authenticated using (organisation_id = (select public.auth_org_id()));
create policy approvals_insert on public.approvals for insert to authenticated
  with check (organisation_id = (select public.auth_org_id()) and status = 'pending' and public.auth_can_write(false));
create policy approvals_decide on public.approvals for update to authenticated
  using (organisation_id = (select public.auth_org_id()) and public.auth_can_write(true))
  with check (organisation_id = (select public.auth_org_id()) and decided_by = (select auth.uid()));

-- Notifications: org-wide (user_id null) or personal.
alter table public.notifications enable row level security;
create policy notifications_read on public.notifications for select to authenticated
  using (organisation_id = (select public.auth_org_id()) and (user_id is null or user_id = (select auth.uid())));
create policy notifications_insert on public.notifications for insert to authenticated
  with check (organisation_id = (select public.auth_org_id()) and public.auth_can_write(false));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (organisation_id = (select public.auth_org_id()) and user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Audit: readable by the org, insert-only for semantic events, never updatable/deletable.
alter table public.audit_logs enable row level security;
create policy audit_read on public.audit_logs for select to authenticated using (organisation_id = (select public.auth_org_id()));
create policy audit_insert on public.audit_logs for insert to authenticated
  with check (organisation_id = (select public.auth_org_id()) and actor_id = (select auth.uid()) and actor_type in ('user', 'agent'));
revoke update, delete, truncate on public.audit_logs from anon, authenticated;

-- Anonymous users get nothing.
revoke all on all tables in schema public from anon;
revoke execute on function public.auth_org_id(), public.auth_role(), public.auth_can_write(boolean) from anon;

-- ───────────────────────────── Founder bootstrap
-- Every new auth user receives an isolated organisation, founder role and a starter executive team.
create function public.bootstrap_founder() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  org uuid; exec_dept uuid; ops_dept uuid; growth_dept uuid; fin_dept uuid; ceo uuid; coo uuid;
begin
  insert into public.organisations (name)
  values (coalesce(nullif(new.raw_user_meta_data ->> 'organisation', ''), split_part(new.email, '@', 1) || ' Empire'))
  returning id into org;

  insert into public.profiles (id, organisation_id, email, full_name, role)
  values (new.id, org, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''), 'founder');

  insert into public.departments (organisation_id, name, description) values
    (org, 'Executive Office', 'Strategy, governance and founder communication') returning id into exec_dept;
  insert into public.departments (organisation_id, name, description) values
    (org, 'Operations', 'Delivery, task execution and workforce management') returning id into ops_dept;
  insert into public.departments (organisation_id, name, description) values
    (org, 'Growth', 'Opportunities, marketing and client acquisition') returning id into growth_dept;
  insert into public.departments (organisation_id, name, description) values
    (org, 'Finance', 'Budgets, cost control and financial reporting') returning id into fin_dept;

  insert into public.agents (organisation_id, name, designation, tier, department_id, instructions)
  values (org, 'Atlas', 'Chief Executive Officer', 'ceo', exec_dept,
    'You are the AI CEO. Set strategy aligned with the founder''s goals, evaluate opportunities by expected value, risk and effort, and produce concise executive reports. Delegate execution to the COO. Escalate anything involving money, legal exposure, external communication or irreversible actions to the founder for approval.')
  returning id into ceo;

  insert into public.agents (organisation_id, name, designation, tier, department_id, manager_id, instructions)
  values (org, 'Orion', 'Chief Operating Officer', 'coo', ops_dept, ceo,
    'You are the AI COO. Convert strategy into concrete projects and tasks, assign each task to the most suitable agent, track progress and unblock dependencies. Report operational status factually. Never approve your own spending or external actions.')
  returning id into coo;

  insert into public.agents (organisation_id, name, designation, tier, department_id, manager_id, instructions) values
    (org, 'Nova', 'Chief Growth Officer', 'executive', growth_dept, ceo,
     'You are the AI Chief Growth Officer. Identify revenue opportunities, design low-cost acquisition experiments and draft (never send) client communication for founder approval.'),
    (org, 'Ledger', 'Chief Financial Officer', 'executive', fin_dept, ceo,
     'You are the AI CFO. Track budgets and costs, flag overspend, and prepare financial summaries. You may never move money; all financial actions require founder approval.');

  insert into public.agent_permissions (organisation_id, agent_id, permission)
  select org, a.id, p.permission
    from public.agents a
    cross join lateral unnest(case a.tier
      when 'ceo' then array['ai.execute', 'tasks.create', 'tasks.delegate', 'opportunities.create', 'approvals.request', 'reports.create']
      when 'coo' then array['ai.execute', 'tasks.create', 'tasks.delegate', 'projects.create', 'approvals.request', 'reports.create']
      else array['ai.execute', 'tasks.create', 'approvals.request', 'reports.create'] end) as p(permission)
   where a.organisation_id = org;

  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.bootstrap_founder();
