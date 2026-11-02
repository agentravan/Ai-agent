-- AI Empire OS — Idea Court: an idea (from the Founder or a meeting) is put on trial.
-- Prosecutor asks the hardest questions, Defence fights back, 12 jurors vote BUILD / FIX / KILL,
-- the Judge gives the verdict, the fix, the cheapest next test and a one-line vision for the team.

create table public.idea_trials (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  idea            text not null check (length(idea) between 5 and 2000),
  proposed_by     text check (length(proposed_by) <= 120),
  meeting_id      uuid,
  stage           text not null default 'filed' check (stage in ('filed', 'prosecuted', 'defended', 'decided', 'failed')),
  prosecution     jsonb,
  defence         jsonb,
  jury            jsonb,
  verdict         text check (verdict in ('build', 'fix', 'kill')),
  ruling          jsonb,
  error           text check (length(error) <= 500),
  adopted_at      timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, meeting_id) references public.board_meetings (organisation_id, id) on delete set null (meeting_id)
);
create index idea_trials_recent_idx on public.idea_trials (organisation_id, created_at desc);

create trigger idea_trials_touch before update on public.idea_trials for each row execute function public.touch_updated_at();
create trigger idea_trials_audit after insert or update or delete on public.idea_trials for each row execute function private.audit_row_change();
alter table public.idea_trials enable row level security;
create policy idea_trials_read on public.idea_trials for select to authenticated using (organisation_id = (select private.auth_org_id()));
create policy idea_trials_insert on public.idea_trials for insert to authenticated
  with check (organisation_id = (select private.auth_org_id()) and private.auth_can_write(false));
create policy idea_trials_update on public.idea_trials for update to authenticated
  using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(false)) with check (organisation_id = (select private.auth_org_id()));
create policy idea_trials_delete on public.idea_trials for delete to authenticated
  using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(true));
revoke all on public.idea_trials from anon;

-- Adopting a verdict as the team's vision is a Founder/admin decision.
create function private.guard_trial_adoption() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.adopted_at is not null and old.adopted_at is null and not private.auth_can_write(true) then
    raise exception 'only the founder or an admin can adopt a verdict as team vision' using errcode = 'insufficient_privilege';
  end if;
  if new.adopted_at is not null and new.stage <> 'decided' then
    raise exception 'only a decided trial can be adopted' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.guard_trial_adoption() from public, anon, authenticated;
create trigger idea_trials_guard before update on public.idea_trials for each row execute function private.guard_trial_adoption();

-- Nyaya: the court (judge, prosecutor, defence and jury are played by this agent with role prompts).
create function private.seed_court(org uuid) returns void
language plpgsql set search_path = '' as $$
begin
  insert into public.agents (organisation_id, name, designation, tier, department_id, manager_id, instructions)
  select org, 'Nyaya', 'Idea Court — Judge & Strategy Reviewer', 'worker',
         (select id from public.departments where organisation_id = org and name = 'Executive Office'),
         (select id from public.agents where organisation_id = org and tier = 'ceo'),
         'You run the Idea Court. You test ideas honestly before the company spends time on them: the prosecution finds the real weaknesses, '
         || 'the defence makes the strongest honest case, the jury judges from many viewpoints, and the verdict gives a fix, the cheapest next test '
         || 'and a one-line vision. Never invent data, customers or results; say what must be tested instead.'
  on conflict (organisation_id, name) do nothing;

  insert into public.agent_permissions (organisation_id, agent_id, permission)
  select org, a.id, p from public.agents a
   cross join unnest(array['ai.execute', 'reports.create']) as p
   where a.organisation_id = org and a.name = 'Nyaya'
  on conflict do nothing;
end $$;
revoke all on function private.seed_court(uuid) from public, anon, authenticated;

create function private.seed_new_founder_court() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_court(p.organisation_id) from public.profiles p where p.id = new.id;
  return new;
end $$;
revoke all on function private.seed_new_founder_court() from public, anon, authenticated;
create trigger on_auth_user_created_seed_court after insert on auth.users
  for each row execute function private.seed_new_founder_court();

select private.seed_court(id) from public.organisations;
