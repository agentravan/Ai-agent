-- Idempotent tasks created from external systems (e.g. one "place on Meesho" task per Buyontime order).
alter table public.tasks add column external_ref text check (length(external_ref) <= 120);
create unique index tasks_external_ref_idx on public.tasks (organisation_id, external_ref) where external_ref is not null;
