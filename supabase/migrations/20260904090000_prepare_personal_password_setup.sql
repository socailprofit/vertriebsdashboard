begin;

-- Stufe 1 von 2: Die neue Spalte und der eng begrenzte Abschluss-RPC werden
-- bereitgestellt, ohne bestehende Konten oder Dashboard-Abfragen zu sperren.
-- Diese Migration muss vor dem Frontend mit der Passwortseite produktiv sein.
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

create or replace function public.has_dashboard_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.must_change_password = false
  );
$$;

revoke all on function public.has_dashboard_access() from public, anon;
grant execute on function public.has_dashboard_access() to authenticated;

-- Dieser RPC kann nur die eigene Profilsperre aufheben. Die eigentliche
-- Sperre und alle Daten-Policies folgen bewusst erst in Stufe 2, nachdem
-- GitHub Pages die Passwortseite nachweislich ausliefert.
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

  update public.profiles
  set must_change_password = false
  where user_id = auth.uid()
    and must_change_password = true;
end;
$$;

revoke all on function public.complete_personal_password_setup() from public, anon;
grant execute on function public.complete_personal_password_setup() to authenticated;

commit;
