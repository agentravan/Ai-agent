-- AI Empire OS — Agency toolkit: Google Places leads, Agency Agents library, LinkedIn content desk, local rank tracker.

-- ───────────────────────────── Leads can come from Google Places (optional key) as well as OpenStreetMap.
alter table public.leads drop constraint leads_source_check;
alter table public.leads add constraint leads_source_check check (source in ('openstreetmap', 'google_places', 'manual'));

-- ───────────────────────────── Agents hired from the Agency Agents library remember their template.
alter table public.agents add column template_slug text check (template_slug ~ '^[a-z0-9/-]{3,120}$');
create unique index agents_template_slug_idx on public.agents (organisation_id, template_slug) where template_slug is not null;

-- ───────────────────────────── LinkedIn content desk (drafts only: the Founder posts them by hand)
create table public.linkedin_drafts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  kind            text not null check (kind in ('post', 'comment_reply', 'dm_reply')),
  brief           text not null check (length(brief) between 3 and 2000),
  context         text check (length(context) <= 4000),
  body            text check (length(body) <= 3000),
  status          text not null default 'draft' check (status in ('draft', 'approved', 'posted', 'discarded')),
  agent_id        uuid,
  execution_id    uuid references public.agent_executions (id) on delete set null,
  approved_by     uuid references auth.users (id) on delete set null,
  posted_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, id),
  check ((status = 'posted') = (posted_at is not null)),
  foreign key (organisation_id, agent_id) references public.agents (organisation_id, id) on delete set null (agent_id)
);
create index linkedin_drafts_status_idx on public.linkedin_drafts (organisation_id, status, created_at desc);

-- ───────────────────────────── Local rank tracker (Google Places ranking for a keyword)
create table public.rank_keywords (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  keyword         text not null check (length(keyword) between 2 and 200),
  business        text not null check (length(business) between 2 and 200),
  place_id        text check (length(place_id) <= 200),
  place_name      text check (length(place_name) <= 200),
  place_address   text check (length(place_address) <= 300),
  active          boolean not null default true,
  last_position   smallint check (last_position between 1 and 60),
  last_checked_at timestamptz,
  last_error      text check (length(last_error) <= 300),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, keyword, business)
);
create index rank_keywords_due_idx on public.rank_keywords (organisation_id, active, last_checked_at nulls first);

create table public.rank_checks (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  keyword_id      uuid not null,
  position        smallint check (position between 1 and 60),
  scanned         smallint not null default 0 check (scanned between 0 and 60),
  checked_at      timestamptz not null default now(),
  foreign key (organisation_id, keyword_id) references public.rank_keywords (organisation_id, id) on delete cascade
);
create index rank_checks_keyword_idx on public.rank_checks (keyword_id, checked_at desc);

-- ───────────────────────────── Triggers + RLS (same tenant model as the sales engine)
do $$
declare t text;
begin
  foreach t in array array['linkedin_drafts', 'rank_keywords'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['linkedin_drafts', 'rank_keywords', 'rank_checks'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function private.audit_row_change()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (organisation_id = (select private.auth_org_id()))', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (organisation_id = (select private.auth_org_id()) and private.auth_can_write(false))', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(false)) with check (organisation_id = (select private.auth_org_id()))', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (organisation_id = (select private.auth_org_id()) and private.auth_can_write(true))', t, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Publishing on LinkedIn is external communication: only the Founder or an admin may approve it, and only approved text is posted.
create function private.guard_linkedin_approval() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status in ('approved', 'posted') and old.status is distinct from new.status and old.status not in ('approved', 'posted')
     and not private.auth_can_write(true) then
    raise exception 'only the founder or an admin can approve LinkedIn content' using errcode = 'insufficient_privilege';
  end if;
  if new.status = 'posted' and old.status is distinct from 'posted' and old.status <> 'approved' then
    raise exception 'LinkedIn content must be approved before posting' using errcode = 'check_violation';
  end if;
  if old.status in ('approved', 'posted') and new.body is distinct from old.body then
    raise exception 'approved LinkedIn content cannot be edited; create a new draft' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.guard_linkedin_approval() from public, anon, authenticated;
create trigger linkedin_drafts_guard before update on public.linkedin_drafts for each row execute function private.guard_linkedin_approval();

-- ───────────────────────────── Iris (Sales & Social Media manager) drafts content.
create function private.seed_agency_toolkit(org uuid) returns void
language plpgsql set search_path = '' as $$
begin
  insert into public.agent_permissions (organisation_id, agent_id, permission)
  select org, a.id, 'content.draft' from public.agents a
   where a.organisation_id = org and a.name in ('Iris', 'Nova')
  on conflict do nothing;
end $$;
revoke all on function private.seed_agency_toolkit(uuid) from public, anon, authenticated;

create function private.seed_new_founder_toolkit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_agency_toolkit(p.organisation_id) from public.profiles p where p.id = new.id;
  return new;
end $$;
revoke all on function private.seed_new_founder_toolkit() from public, anon, authenticated;
-- Name sorts after on_auth_user_created_seed_sales, so Iris already exists.
create trigger on_auth_user_created_seed_toolkit after insert on auth.users
  for each row execute function private.seed_new_founder_toolkit();

select private.seed_agency_toolkit(id) from public.organisations;
