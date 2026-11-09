-- AI Empire OS — Design Studio (Elephant–Goldfish Model, adapted from google/elephant-goldfish-model, Apache-2.0).
-- Design with an elephant, review with a goldfish:
--   Gaja (the Elephant) knows the company and writes the brief and the design document.
--   Meen (the Goldfish) reviews the document with NO memory, playbooks or conversation — only the text — so it
--   catches what the writer assumed but never wrote down.
--   The Founder decides which findings to fix and approves the design before anything is built.

create table public.design_docs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  title           text not null check (length(title) between 3 and 160),
  idea            text not null check (length(idea) between 5 and 4000),
  stage           text not null default 'brief' check (stage in ('brief', 'draft', 'review', 'approved')),
  brief           text check (length(brief) <= 20000),
  challenges      jsonb,
  draft           text check (length(draft) <= 60000),
  round           integer not null default 0 check (round between 0 and 100),
  error           text check (length(error) <= 500),
  approved_at     timestamptz,
  approved_by     uuid references auth.users (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, id)
);
create index design_docs_recent_idx on public.design_docs (organisation_id, created_at desc);

-- One goldfish review per lens per review round (a second concurrent run of the same lens is rejected).
create table public.design_reviews (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  doc_id          uuid not null,
  round           integer not null check (round between 1 and 100),
  lens            text not null check (lens in ('zoom_out', 'comprehension', 'design', 'readiness')),
  paraphrase      text check (length(paraphrase) <= 4000),
  created_at      timestamptz not null default now(),
  unique (doc_id, round, lens),
  unique (organisation_id, id),
  foreign key (organisation_id, doc_id) references public.design_docs (organisation_id, id) on delete cascade
);

create table public.design_findings (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  doc_id          uuid not null,
  review_id       uuid not null,
  round           integer not null check (round between 1 and 100),
  lens            text not null,
  severity        text not null check (severity in ('blocker', 'major', 'minor')),
  title           text not null check (length(title) between 2 and 300),
  detail          text not null default '' check (length(detail) <= 1500),
  fix             text not null default '' check (length(fix) <= 1500),
  decision        text not null default 'open' check (decision in ('open', 'fix', 'skip')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (organisation_id, doc_id) references public.design_docs (organisation_id, id) on delete cascade,
  foreign key (organisation_id, review_id) references public.design_reviews (organisation_id, id) on delete cascade
);
create index design_findings_doc_idx on public.design_findings (doc_id, round);

create trigger design_docs_touch before update on public.design_docs for each row execute function public.touch_updated_at();
create trigger design_findings_touch before update on public.design_findings for each row execute function public.touch_updated_at();
create trigger design_docs_audit after insert or update or delete on public.design_docs for each row execute function private.audit_row_change();
create trigger design_findings_audit after insert or update or delete on public.design_findings for each row execute function private.audit_row_change();

alter table public.design_docs enable row level security;
alter table public.design_reviews enable row level security;
alter table public.design_findings enable row level security;

create policy design_docs_read on public.design_docs for select to authenticated using (organisation_id = (select private.auth_org_id()));
create policy design_docs_insert on public.design_docs for insert to authenticated
  with check (organisation_id = (select private.auth_org_id()) and private.auth_can_write(false) and approved_at is null and stage = 'brief');
create policy design_docs_update on public.design_docs for update to authenticated
  using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(false)) with check (organisation_id = (select private.auth_org_id()));
create policy design_docs_delete on public.design_docs for delete to authenticated
  using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(true));

create policy design_reviews_read on public.design_reviews for select to authenticated using (organisation_id = (select private.auth_org_id()));
create policy design_reviews_insert on public.design_reviews for insert to authenticated
  with check (organisation_id = (select private.auth_org_id()) and private.auth_can_write(false));
-- Only to roll back a review whose findings failed to save (no findings yet, design not approved).
create policy design_reviews_delete on public.design_reviews for delete to authenticated
  using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(false)
         and not exists (select 1 from public.design_findings f where f.review_id = design_reviews.id)
         and not exists (select 1 from public.design_docs d where d.id = design_reviews.doc_id and d.approved_at is not null));

create policy design_findings_read on public.design_findings for select to authenticated using (organisation_id = (select private.auth_org_id()));
create policy design_findings_insert on public.design_findings for insert to authenticated
  with check (organisation_id = (select private.auth_org_id()) and private.auth_can_write(false) and decision = 'open');
create policy design_findings_update on public.design_findings for update to authenticated
  using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(false)) with check (organisation_id = (select private.auth_org_id()));

revoke all on public.design_docs, public.design_reviews, public.design_findings from anon;

-- Guard: approval is a Founder/admin decision, made only on a fully reviewed draft with every blocker settled;
-- an approved design is frozen, and a draft under review cannot change without leaving review.
create function private.guard_design_doc() returns trigger
language plpgsql set search_path = '' as $$
declare lenses int; unsettled int;
begin
  if old.approved_at is not null then
    if new.approved_at is distinct from old.approved_at or new.stage <> 'approved'
       or new.draft is distinct from old.draft or new.brief is distinct from old.brief or new.title is distinct from old.title then
      raise exception 'an approved design is frozen' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.stage = 'review' and new.draft is distinct from old.draft and new.stage <> 'draft' then
    raise exception 'a reviewed draft cannot change while it is under review' using errcode = 'check_violation';
  end if;
  if new.stage = 'approved' or new.approved_at is not null then
    if not private.auth_can_write(true) then
      raise exception 'only the founder or an admin can approve a design' using errcode = 'insufficient_privilege';
    end if;
    if new.stage <> 'approved' or new.approved_at is null or old.stage <> 'review' or new.draft is null or new.draft is distinct from old.draft then
      raise exception 'only a draft under review can be approved, unchanged' using errcode = 'check_violation';
    end if;
    -- Keep in step with REVIEWERS in src/modules/design/logic.ts (four goldfish lenses).
    select count(*) into lenses from public.design_reviews where doc_id = new.id and round = new.round;
    select count(*) into unsettled from public.design_findings
     where doc_id = new.id and round = new.round and (decision = 'fix' or (severity = 'blocker' and decision = 'open'));
    if lenses < 4 then
      raise exception 'all four goldfish reviews must finish before approval' using errcode = 'check_violation';
    end if;
    if unsettled > 0 then
      raise exception 'settle every blocker and revise the findings marked fix before approval' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_design_doc() from public, anon, authenticated;
create trigger design_docs_guard before update on public.design_docs for each row execute function private.guard_design_doc();

-- Findings of an approved design are part of the record.
create function private.guard_design_finding() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.design_docs d where d.id = new.doc_id and d.approved_at is not null) then
    raise exception 'an approved design is frozen' using errcode = 'check_violation';
  end if;
  if new.doc_id <> old.doc_id or new.review_id <> old.review_id or new.round <> old.round or new.lens <> old.lens
     or new.severity <> old.severity or new.title <> old.title or new.detail <> old.detail or new.fix <> old.fix then
    raise exception 'only the decision on a finding can change' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.guard_design_finding() from public, anon, authenticated;
create trigger design_findings_guard before update on public.design_findings for each row execute function private.guard_design_finding();

-- Gaja (Elephant) writes; Meen (Goldfish) reviews with a fresh, memory-less context.
create function private.seed_design_studio(org uuid) returns void
language plpgsql set search_path = '' as $$
declare manager uuid;
begin
  select id into manager from public.agents where organisation_id = org and name = 'Pragati';
  if manager is null then select id into manager from public.agents where organisation_id = org and tier = 'ceo'; end if;

  insert into public.agents (organisation_id, name, designation, tier, department_id, manager_id, instructions)
  values
    (org, 'Gaja', 'Design Studio — Design Lead (Elephant)', 'worker',
     (select id from public.departments where organisation_id = org and name = 'Executive Office'), manager,
     'You are the Elephant of the Design Studio. You remember the company, its goals and its decisions. You turn the Founder''s idea into a '
     || 'clear brief and then a design document for software (websites, management systems, internal tools) BEFORE anything is built. '
     || 'Write so that a stranger with no background can follow it: define every term, state every assumption, list what is out of scope, '
     || 'and end with a step-by-step implementation plan. Prefer the simplest design that works on free tools. Never invent data.'),
    (org, 'Meen', 'Design Studio — Fresh Reviewer (Goldfish)', 'worker',
     (select id from public.departments where organisation_id = org and name = 'Executive Office'), manager,
     'You are the Goldfish of the Design Studio. You review a design document with no memory and no background: only the text you are given. '
     || 'Read it as a new team member. Find what is unclear, assumed, risky, over-built or not ready to build. Lead with problems, never flatter, '
     || 'and give a concrete fix for each finding.')
  on conflict (organisation_id, name) do nothing;

  insert into public.agent_permissions (organisation_id, agent_id, permission)
  select org, a.id, p from public.agents a
   cross join unnest(array['ai.execute', 'reports.create']) as p
   where a.organisation_id = org and a.name in ('Gaja', 'Meen')
  on conflict do nothing;
end $$;
revoke all on function private.seed_design_studio(uuid) from public, anon, authenticated;

create function private.seed_new_founder_design_studio() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_design_studio(p.organisation_id) from public.profiles p where p.id = new.id;
  return new;
end $$;
revoke all on function private.seed_new_founder_design_studio() from public, anon, authenticated;
create trigger on_auth_user_created_seed_design_studio after insert on auth.users
  for each row execute function private.seed_new_founder_design_studio();

select private.seed_design_studio(id) from public.organisations;
