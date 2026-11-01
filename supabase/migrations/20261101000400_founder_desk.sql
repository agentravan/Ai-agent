-- AI Empire OS — Founder desk (physical tasks), company goals and spending gate.

-- North-star target and the profit gate before any paid system upgrade (both editable by the Founder).
alter table public.organisations
  add column north_star_target_cents bigint not null default 100000000000000 check (north_star_target_cents > 0), -- ₹1,00,000 crore
  add column upgrade_profit_gate_cents bigint not null default 8000000 check (upgrade_profit_gate_cents >= 0);      -- ₹80,000

-- Founder-owned tasks: calls, meetings, placing orders, anything physical.
alter table public.tasks
  add column owner text not null default 'agent' check (owner in ('agent', 'founder')),
  add column task_type text not null default 'work' check (task_type in ('work', 'call', 'meeting', 'order', 'physical', 'other')),
  add column lead_id uuid;
alter table public.tasks add foreign key (organisation_id, lead_id) references public.leads (organisation_id, id) on delete set null (lead_id);
alter table public.tasks add constraint tasks_founder_unassigned check (owner = 'agent' or assigned_agent_id is null);
create index tasks_owner_idx on public.tasks (organisation_id, owner, status);
create index tasks_lead_idx on public.tasks (lead_id);

-- When a lead replies or is won, the Founder automatically gets the human follow-up task.
create function private.lead_followup_task() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'replied' and old.status is distinct from 'replied' then
    insert into public.tasks (organisation_id, title, description, priority, owner, task_type, lead_id)
    values (new.organisation_id, left('Call / meet ' || new.name, 200),
            concat_ws(E'\n', 'They replied to our pitch.', 'Phone: ' || new.phone, 'Email: ' || new.email, new.outcome_note),
            'high', 'founder', 'call', new.id);
  elsif new.status = 'won' and old.status is distinct from 'won' then
    insert into public.tasks (organisation_id, title, description, priority, owner, task_type, lead_id)
    values (new.organisation_id, left('Kick-off with ' || new.name, 200),
            concat_ws(E'\n', 'New client won. Confirm requirements, timeline and first invoice.', 'Phone: ' || new.phone, 'Email: ' || new.email),
            'high', 'founder', 'meeting', new.id);
  end if;
  return null;
end $$;
revoke all on function private.lead_followup_task() from public, anon, authenticated;
create trigger leads_followup_task after update on public.leads for each row execute function private.lead_followup_task();
