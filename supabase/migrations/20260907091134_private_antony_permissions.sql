begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.antony_permissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.antony_permissions enable row level security;
revoke all on private.antony_permissions from public, anon, authenticated;

-- Preserve the exact existing allowlist, including pending password setups.
-- The legacy addresses are read only inside the database.
insert into private.antony_permissions(user_id)
select u.id from auth.users u where lower(u.email) in (
  select lower(m[1]) from regexp_matches(
    pg_get_functiondef('public.has_antony_access()'::regprocedure),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+', 'g'
  ) as m
);

-- Fresh installations have no grants until an administrator assigns auth user
-- IDs privately. A manager role alone does not grant access.
create or replace function public.has_antony_access()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.antony_permissions a
    join public.profiles p on p.user_id = a.user_id
    where a.user_id = auth.uid() and p.must_change_password = false
  );
$$;
revoke all on function public.has_antony_access() from public, anon;
grant execute on function public.has_antony_access() to authenticated;
commit;
