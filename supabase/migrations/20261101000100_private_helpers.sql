-- Move SECURITY DEFINER helpers out of the API-exposed public schema.
-- Policies and triggers bind by OID, so they keep working after the move.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

alter function public.auth_org_id()            set schema private;
alter function public.auth_role()              set schema private;
alter function public.auth_can_write(boolean)  set schema private;
alter function public.audit_row_change()       set schema private;
alter function public.bootstrap_founder()      set schema private;

-- Functions are executable by PUBLIC by default: restrict to what RLS evaluation needs.
revoke all on function private.auth_org_id(), private.auth_role(), private.auth_can_write(boolean),
  private.audit_row_change(), private.bootstrap_founder() from public, anon, authenticated;
grant execute on function private.auth_org_id(), private.auth_role(), private.auth_can_write(boolean) to authenticated;
