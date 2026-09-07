begin;

-- Only an actual password change in Supabase Auth unlocks a pending profile.
-- No password or hash is copied into an application table or returned by RPC.
create or replace function public.record_personal_password_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password
     and coalesce(new.encrypted_password, '') <> '' then
    update public.profiles
    set must_change_password = false
    where user_id = new.id and must_change_password = true;
  end if;
  return new;
end;
$$;

revoke all on function public.record_personal_password_change() from public, anon, authenticated;

create trigger on_auth_password_changed
after update of encrypted_password on auth.users
for each row execute function public.record_personal_password_change();

-- Keep the existing browser API, but it can no longer unlock an account.
create or replace function public.complete_personal_password_setup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Anmeldung erforderlich' using errcode = '42501';
  end if;
  if not public.has_dashboard_access() then
    raise exception 'Persönliches Passwort zuerst über Supabase Auth ändern'
      using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.complete_personal_password_setup() from public, anon;
grant execute on function public.complete_personal_password_setup() to authenticated;

-- Trigger entry points are internal, never browser RPCs.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- TRUNCATE is not constrained by RLS. Browser roles do not need DDL privileges.
revoke truncate, references, trigger on all tables in schema public from public, anon, authenticated;

-- Managers may maintain names/assignments under the existing RLS policy.
-- Roles and password gates are administered only through trusted backend access.
revoke update on public.profiles from authenticated;
grant update (display_name, sales_person_id) on public.profiles to authenticated;

-- New objects require explicit client grants; service_role defaults are preserved.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

commit;
