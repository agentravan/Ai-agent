-- AI Empire OS — Meeting room: live conversation with the Founder, note-taker (Scribe), minutes of meeting (MOM),
-- team meetings, and daily morning / evening stand-ups.

-- ───────────────────────────── Meetings: kind, participants, minutes
alter table public.board_meetings
  add column kind            text not null default 'board' check (kind in ('board', 'team', 'morning', 'evening')),
  add column host_agent_id   uuid,
  add column participant_ids uuid[] not null default '{}' check (cardinality(participant_ids) <= 12),
  add column meeting_date    date,
  add column mom             jsonb,
  add column mom_execution_id uuid references public.agent_executions (id) on delete set null,
  add column mom_emailed_at  timestamptz,
  add column ended_at        timestamptz,
  add foreign key (organisation_id, host_agent_id) references public.agents (organisation_id, id) on delete set null (host_agent_id);
-- One morning and one evening stand-up per day (the scheduler may fire more than once).
create unique index board_meetings_daily_idx on public.board_meetings (organisation_id, kind, meeting_date)
  where kind in ('morning', 'evening') and meeting_date is not null;
create index board_meetings_kind_idx on public.board_meetings (organisation_id, kind, created_at desc);

-- ───────────────────────────── Messages: who is talking (member, Founder, Scribe), long conversations
alter table public.board_messages drop constraint board_messages_seq_check;
alter table public.board_messages add constraint board_messages_seq_check check (seq between 0 and 1000);
alter table public.board_messages
  add column role text not null default 'member' check (role in ('member', 'founder', 'scribe', 'system'));

-- ───────────────────────────── Scribe: the note-taker who writes the minutes and turns action items into work
create function private.seed_scribe(org uuid) returns void
language plpgsql set search_path = '' as $$
begin
  insert into public.agents (organisation_id, name, designation, tier, department_id, manager_id, instructions)
  select org, 'Scribe', 'Meeting Secretary & Note-taker', 'worker',
         (select id from public.departments where organisation_id = org and name = 'Executive Office'),
         (select id from public.agents where organisation_id = org and tier = 'ceo'),
         'You are the meeting secretary. You record exactly what was said and decided — never add opinions, numbers or decisions nobody made. '
         || 'Write minutes of meeting (MOM): summary, decisions, action items with a clear owner and due date, risks, opportunities, '
         || 'follow-ups for the next meeting and the next agenda. Owners must be people who were in the meeting or the Founder.'
  on conflict (organisation_id, name) do nothing;

  insert into public.agent_permissions (organisation_id, agent_id, permission)
  select org, a.id, p from public.agents a
   cross join unnest(array['ai.execute', 'tasks.create', 'tasks.delegate', 'approvals.request', 'reports.create']) as p
   where a.organisation_id = org and a.name = 'Scribe'
  on conflict do nothing;
end $$;
revoke all on function private.seed_scribe(uuid) from public, anon, authenticated;

create function private.seed_new_founder_scribe() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_scribe(p.organisation_id) from public.profiles p where p.id = new.id;
  return new;
end $$;
revoke all on function private.seed_new_founder_scribe() from public, anon, authenticated;
-- Sorts after on_auth_user_created_seed_board, so the CEO and Executive Office exist.
create trigger on_auth_user_created_seed_scribe after insert on auth.users
  for each row execute function private.seed_new_founder_scribe();

select private.seed_scribe(id) from public.organisations;
