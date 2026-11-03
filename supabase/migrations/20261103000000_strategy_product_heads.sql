-- Two executive roles from Open Executive's specialist bench that AI Empire OS did not have yet:
-- Chief Strategy Officer (Chanakya) and Chief Product Officer (Pragati). Additive only: no existing row changes.
-- They report to the CEO, sit in the Executive Office, read their own Executive Playbooks, and never decide alone.

create function private.seed_strategy_product(org uuid) returns void
language plpgsql set search_path = '' as $$
begin
  insert into public.agents (organisation_id, name, designation, tier, department_id, manager_id, instructions)
  select org, v.name, v.designation, 'executive',
         (select id from public.departments where organisation_id = org and name = 'Executive Office'),
         (select id from public.agents where organisation_id = org and tier = 'ceo'),
         v.instructions
    from (values
      ('Chanakya', 'Chief Strategy Officer',
       'You are the AI Chief Strategy Officer. Find where the company can win fastest with what it already has: pick markets and niches, '
       || 'size them bottom-up from real inputs, study competitors, set quarterly OKRs and run a weekly review of what worked. '
       || 'Every plan names the cheapest test first and how we will know it worked. Say "data needed" instead of guessing numbers. '
       || 'Spending, partnerships and anything external go to the Founder for approval.'),
      ('Pragati', 'Chief Product Officer',
       'You are the AI Chief Product Officer. Turn what clients ask for into simple, sellable service packages and product ideas: '
       || 'talk-to-customer plans, clear problem statements, ruthless prioritisation (impact vs effort), small launches and honest '
       || 'measurement. Prefer a manual service that sells today over software that might sell later. '
       || 'Never promise features, dates or prices to clients yourself; propose them for Founder approval.')
    ) as v(name, designation, instructions)
  on conflict (organisation_id, name) do nothing;

  insert into public.agent_permissions (organisation_id, agent_id, permission)
  select org, a.id, p from public.agents a
   cross join unnest(array['ai.execute', 'tasks.create', 'approvals.request', 'reports.create']) as p
   where a.organisation_id = org and a.name in ('Chanakya', 'Pragati')
  on conflict do nothing;
end $$;
revoke all on function private.seed_strategy_product(uuid) from public, anon, authenticated;

create function private.seed_new_founder_strategy_product() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_strategy_product(p.organisation_id) from public.profiles p where p.id = new.id;
  return new;
end $$;
revoke all on function private.seed_new_founder_strategy_product() from public, anon, authenticated;
create trigger on_auth_user_created_seed_strategy_product after insert on auth.users
  for each row execute function private.seed_new_founder_strategy_product();

select private.seed_strategy_product(id) from public.organisations;
