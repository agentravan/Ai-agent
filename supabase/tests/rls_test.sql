-- Verifies bootstrap, tenant isolation, role checks, cycle guard, approval lock and audit immutability.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'founder@a.test'),
  ('22222222-2222-2222-2222-222222222222', 'founder@b.test');

do $$ begin
  assert (select count(*) from public.organisations) = 2, 'one org per founder';
  assert (select count(*) from public.agents) = 8, 'four starter agents each';
  assert (select count(*) from public.profiles where role = 'founder') = 2, 'founder role';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

do $$
declare other_agent uuid; t1 uuid; t2 uuid; appr uuid;
begin
  assert (select count(*) from public.agents) = 4, 'RLS: sees only own agents';
  assert (select count(*) from public.organisations) = 1, 'RLS: sees only own org';

  insert into public.tasks (organisation_id, title) values (public.auth_org_id(), 'A') returning id into t1;
  insert into public.tasks (organisation_id, title) values (public.auth_org_id(), 'B') returning id into t2;
  insert into public.task_dependencies (organisation_id, task_id, depends_on_task_id) values (public.auth_org_id(), t2, t1);
  begin
    insert into public.task_dependencies (organisation_id, task_id, depends_on_task_id) values (public.auth_org_id(), t1, t2);
    raise exception 'cycle not rejected';
  exception when check_violation then null; end;

  insert into public.approvals (organisation_id, title, action_type) values (public.auth_org_id(), 'Spend', 'finance.spend') returning id into appr;
  update public.approvals set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = appr;
  begin
    update public.approvals set status = 'rejected' where id = appr;
    raise exception 'decided approval was modified';
  exception when check_violation then null; end;

  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'role escalation allowed';
  exception when insufficient_privilege then null; end;

  begin
    delete from public.audit_logs;
    raise exception 'audit delete allowed';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.audit_logs where entity = 'tasks') >= 2, 'task changes audited';
end $$;

-- Cross-tenant write must fail even with a known foreign id.
reset role;
select set_config('test.foreign_agent', id::text, false) from public.agents
 where organisation_id <> (select organisation_id from public.profiles where email = 'founder@a.test') limit 1;
set role authenticated;
do $$ begin
  begin
    insert into public.tasks (organisation_id, title, assigned_agent_id) values (public.auth_org_id(), 'X', current_setting('test.foreign_agent')::uuid);
    raise exception 'cross-tenant reference allowed';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.tasks (organisation_id, title)
    values ((select organisation_id from public.agents where id = current_setting('test.foreign_agent')::uuid), 'Y');
    raise exception 'cross-tenant insert allowed';
  exception when not_null_violation or insufficient_privilege then null; end;
end $$;

-- Viewers cannot write.
reset role;
update public.profiles set role = 'viewer' where email = 'founder@a.test';
set role authenticated;
do $$ begin
  begin
    insert into public.tasks (organisation_id, title) values (public.auth_org_id(), 'V');
    raise exception 'viewer write allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- Organisation deletion cascades cleanly.
reset role;
delete from public.organisations;
do $$ begin assert (select count(*) from public.agents) = 0, 'cascade'; end $$;
select 'ALL RLS TESTS PASSED' as result;
