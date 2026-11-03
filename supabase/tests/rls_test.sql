-- Verifies bootstrap, tenant isolation, role checks, cycle guard, approval lock and audit immutability.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'founder@a.test'),
  ('22222222-2222-2222-2222-222222222222', 'founder@b.test');

do $$ begin
  assert (select count(*) from public.organisations) = 2, 'one org per founder';
  assert (select count(*) from public.agents) = 26, 'thirteen starter agents each (4 executives + Legal Head + Strategy + Product + 4 managers + Scribe + Nyaya)';
  assert (select count(*) from public.agents where name in ('Chanakya', 'Pragati') and tier = 'executive') = 4, 'Strategy and Product heads seeded';
  assert (select count(*) from public.agents where name = 'Nyaya') = 2, 'Idea Court seeded';
  assert (select count(*) from public.agents where name = 'Scribe') = 2, 'Scribe seeded';
  assert (select count(*) from public.agents where name = 'Themis' and tier = 'executive') = 2, 'Legal Head seeded';
  assert (select bool_and(north_star_usd = 100000000000 and north_star_target_cents = 100000000000 * 95 * 100) from public.organisations), '$100B north star in INR paise';
  assert (select count(*) from public.business_units) = 8, 'four business units each';
  assert (select count(*) from public.kras) = 20, 'ten KRAs each';
  assert (select count(*) from public.business_units where manager_agent_id is null) = 0, 'every unit has a manager';
  perform private.seed_executive_office(id) from public.organisations;
  perform private.seed_sales_engine(id) from public.organisations;
  perform private.seed_board(id) from public.organisations;
  perform private.seed_scribe(id) from public.organisations;
  perform private.seed_court(id) from public.organisations;
  perform private.seed_strategy_product(id) from public.organisations;
  assert (select count(*) from public.agents) = 26, 'seed is idempotent';
  assert (select count(*) from public.profiles where role = 'founder') = 2, 'founder role';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

do $$
declare other_agent uuid; t1 uuid; t2 uuid; appr uuid;
begin
  assert (select count(*) from public.agents) = 13, 'RLS: sees only own agents';
  assert (select count(*) from public.kras) = 10, 'RLS: sees only own KRAs';
  assert (select count(*) from public.organisations) = 1, 'RLS: sees only own org';

  insert into public.tasks (organisation_id, title) values (private.auth_org_id(), 'A') returning id into t1;
  insert into public.tasks (organisation_id, title) values (private.auth_org_id(), 'B') returning id into t2;
  insert into public.task_dependencies (organisation_id, task_id, depends_on_task_id) values (private.auth_org_id(), t2, t1);
  begin
    insert into public.task_dependencies (organisation_id, task_id, depends_on_task_id) values (private.auth_org_id(), t1, t2);
    raise exception 'cycle not rejected';
  exception when check_violation then null; end;

  insert into public.approvals (organisation_id, title, action_type) values (private.auth_org_id(), 'Spend', 'finance.spend') returning id into appr;
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

  -- Outreach must be approved before contact.
  insert into public.leads (organisation_id, name) values (private.auth_org_id(), 'Salon X') returning id into t1;
  begin
    update public.leads set status = 'contacted' where id = t1;
    raise exception 'contact without approval allowed';
  exception when check_violation then null; end;
  update public.leads set status = 'approved' where id = t1;
  update public.leads set status = 'contacted' where id = t1;
  update public.leads set status = 'replied' where id = t1;
  assert (select count(*) from public.tasks where lead_id = t1 and owner = 'founder' and task_type = 'call') = 1, 'reply creates founder call task';
  begin
    insert into public.tasks (organisation_id, title, owner, assigned_agent_id)
    values (private.auth_org_id(), 'bad', 'founder', (select id from public.agents limit 1));
    raise exception 'founder task with agent allowed';
  exception when check_violation then null; end;
  assert (select north_star_usd from public.organisations) = 100000000000, 'north star default $100B';
  -- Agency toolkit: Google Places leads, LinkedIn approval gate, rank tracker, content permission.
  insert into public.leads (organisation_id, name, source, source_ref) values (private.auth_org_id(), 'Gym G', 'google_places', 'ChIJabc');
  assert (select count(*) from public.agent_permissions p join public.agents a on a.id = p.agent_id
           where a.name = 'Iris' and p.permission = 'content.draft') = 1, 'Iris can draft content';
  insert into public.linkedin_drafts (organisation_id, kind, brief, body) values (private.auth_org_id(), 'post', 'Gym tips', 'Hello') returning id into t2;
  begin
    update public.linkedin_drafts set status = 'posted', posted_at = now() where id = t2;
    raise exception 'posted without approval';
  exception when check_violation then null; end;
  update public.linkedin_drafts set status = 'approved', approved_by = auth.uid() where id = t2;
  begin
    update public.linkedin_drafts set body = 'Changed' where id = t2;
    raise exception 'approved content edited';
  exception when check_violation then null; end;
  update public.linkedin_drafts set status = 'posted', posted_at = now() where id = t2;
  insert into public.rank_keywords (organisation_id, keyword, business) values (private.auth_org_id(), 'best gym in mumbai', 'Gym G Bandra') returning id into t1;
  insert into public.rank_checks (organisation_id, keyword_id, position, scanned) values (private.auth_org_id(), t1, 3, 60);
  begin
    insert into public.rank_checks (organisation_id, keyword_id, position) values (private.auth_org_id(), t1, 61);
    raise exception 'rank position out of range allowed';
  exception when check_violation then null; end;
  -- WhatsApp Desk: the Founder records sends; opt-outs are permanent.
  insert into public.whatsapp_contacts (organisation_id, chat_id) values (private.auth_org_id(), '919876543210@c.us') returning id into t1;
  insert into public.whatsapp_sends (organisation_id, chat_id, body, kind, sent_by) values (private.auth_org_id(), '919876543210@c.us', 'Namaste!', 'first_contact', auth.uid());
  update public.whatsapp_contacts set opted_out = true, opted_out_at = now() where id = t1;
  begin
    update public.whatsapp_contacts set opted_out = false, opted_out_at = null where id = t1;
    raise exception 'whatsapp opt-out reversed';
  exception when check_violation then null; end;
  begin
    insert into public.whatsapp_contacts (organisation_id, chat_id) values (private.auth_org_id(), 'not-a-number');
    raise exception 'bad chat id allowed';
  exception when check_violation then null; end;
  begin
    insert into public.whatsapp_inbound (organisation_id, wa_message_id, chat_id) values (private.auth_org_id(), 'x', '919876543210@c.us');
    raise exception 'users can forge incoming WhatsApp messages';
  exception when insufficient_privilege then null; end;
  insert into public.whatsapp_outbox (organisation_id, chat_id, body, created_by) values (private.auth_org_id(), '919876543210@c.us', 'Hello', auth.uid());
  begin
    insert into public.whatsapp_outbox (organisation_id, chat_id, body, status, created_by) values (private.auth_org_id(), '919876543210@c.us', 'x', 'sent', auth.uid());
    raise exception 'users can mark messages as sent';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.whatsapp_gateway (organisation_id, status) values (private.auth_org_id(), 'connected');
    raise exception 'users can fake the gateway status';
  exception when insufficient_privilege then null; end;
  -- Board meetings; the INR North Star follows the Founder's USD target and rate.
  insert into public.board_meetings (organisation_id, topic, created_by) values (private.auth_org_id(), 'Phase 0 revenue', auth.uid()) returning id into t1;
  insert into public.board_messages (organisation_id, meeting_id, seq, speaker, body) values (private.auth_org_id(), t1, 0, 'Atlas', 'Start with websites');
  begin
    insert into public.board_messages (organisation_id, meeting_id, seq, speaker, body) values (private.auth_org_id(), t1, 0, 'Orion', 'dup');
    raise exception 'duplicate board message seq allowed';
  exception when unique_violation then null; end;
  insert into public.board_messages (organisation_id, meeting_id, seq, speaker, body, role) values (private.auth_org_id(), t1, 500, 'Founder', 'Price kya rakhein?', 'founder');
  insert into public.board_meetings (organisation_id, topic, kind, meeting_date) values (private.auth_org_id(), 'Morning stand-up', 'morning', '2026-11-02');
  begin
    insert into public.board_meetings (organisation_id, topic, kind, meeting_date) values (private.auth_org_id(), 'Morning again', 'morning', '2026-11-02');
    raise exception 'two morning stand-ups on one day allowed';
  exception when unique_violation then null; end;
  insert into public.board_meetings (organisation_id, topic, kind, meeting_date) values (private.auth_org_id(), 'Evening review', 'evening', '2026-11-02');
  update public.organisations set usd_inr_rate = 90 where id = private.auth_org_id();
  assert (select north_star_target_cents from public.organisations) = 100000000000::bigint * 90 * 100, 'north star follows rate';
  update public.organisations set north_star_target_cents = 1 where id = private.auth_org_id();
  assert (select north_star_target_cents from public.organisations) = 100000000000::bigint * 90 * 100, 'north star cannot drift from USD target';
  -- Idea Court: only a decided trial can be adopted as team vision.
  insert into public.idea_trials (organisation_id, idea, proposed_by) values (private.auth_org_id(), 'Websites for US salons', 'Atlas') returning id into t1;
  begin
    update public.idea_trials set adopted_at = now() where id = t1;
    raise exception 'undecided trial adopted';
  exception when check_violation then null; end;
  update public.idea_trials set stage = 'decided', verdict = 'fix' where id = t1;
  update public.idea_trials set adopted_at = now() where id = t1;
  insert into public.tasks (organisation_id, title, owner, external_ref) values (private.auth_org_id(), 'Place order BOT1', 'founder', 'buyontime:BOT1');
  begin
    insert into public.tasks (organisation_id, title, owner, external_ref) values (private.auth_org_id(), 'dup', 'founder', 'buyontime:BOT1');
    raise exception 'duplicate external task allowed';
  exception when unique_violation then null; end;
end $$;

-- Cross-tenant write must fail even with a known foreign id.
reset role;
select set_config('test.foreign_agent', id::text, false) from public.agents
 where organisation_id <> (select organisation_id from public.profiles where email = 'founder@a.test') limit 1;
set role authenticated;
do $$ begin
  begin
    insert into public.tasks (organisation_id, title, assigned_agent_id) values (private.auth_org_id(), 'X', current_setting('test.foreign_agent')::uuid);
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
    insert into public.tasks (organisation_id, title) values (private.auth_org_id(), 'V');
    raise exception 'viewer write allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- Members can draft leads but cannot approve outreach.
reset role;
update public.profiles set role = 'member' where email = 'founder@a.test';
set role authenticated;
do $$ declare l uuid; begin
  insert into public.leads (organisation_id, name, status) values (private.auth_org_id(), 'Salon Y', 'pitch_ready') returning id into l;
  begin
    update public.leads set status = 'approved' where id = l;
    raise exception 'member approved outreach';
  exception when insufficient_privilege then null; end;
  insert into public.linkedin_drafts (organisation_id, kind, brief, body) values (private.auth_org_id(), 'comment_reply', 'Reply', 'Thanks!') returning id into l;
  begin
    update public.linkedin_drafts set status = 'approved' where id = l;
    raise exception 'member approved LinkedIn content';
  exception when insufficient_privilege then null; end;
  insert into public.idea_trials (organisation_id, idea, stage, verdict) values (private.auth_org_id(), 'Member idea', 'decided', 'build') returning id into l;
  begin
    update public.idea_trials set adopted_at = now() where id = l;
    raise exception 'member adopted a verdict';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.whatsapp_sends (organisation_id, chat_id, body, kind, sent_by) values (private.auth_org_id(), '919876543211@c.us', 'Hi', 'reply', auth.uid());
    raise exception 'member sent a WhatsApp message';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.whatsapp_outbox (organisation_id, chat_id, body, created_by) values (private.auth_org_id(), '919876543211@c.us', 'Hi', auth.uid());
    raise exception 'member queued a WhatsApp message';
  exception when insufficient_privilege then null; end;
end $$;

-- Organisation deletion cascades cleanly.
reset role;
delete from public.organisations;
do $$ begin assert (select count(*) from public.agents) = 0, 'cascade'; end $$;
select 'ALL RLS TESTS PASSED' as result;
