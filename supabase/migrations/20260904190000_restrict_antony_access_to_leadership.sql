begin;

-- Eine einzige serverseitige Entscheidung fuer alle Antony-Funktionen. Die
-- E-Mail wird aus auth.users gelesen, nicht aus vom Nutzer editierbaren
-- user_metadata-Feldern. Ein noch nicht persoenlich eingerichtetes Konto
-- bleibt wie im restlichen Dashboard gesperrt.
create or replace function public.has_antony_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.profiles p on p.user_id = u.id
    where u.id = auth.uid()
      and p.must_change_password = false
      and lower(coalesce(u.email, '')) in (
        'rigone@socialprofit.de',
        'info@socialprofit.de'
      )
  );
$$;

revoke all on function public.has_antony_access() from public, anon;
grant execute on function public.has_antony_access() to authenticated;

-- Die bisherigen Funktionen bleiben als nicht direkt aufrufbare interne
-- Berechnung erhalten. Kleine Wrapper erzwingen die neue Whitelist, bevor
-- irgendeine Antony-Kennzahl an den Browser zurueckgegeben wird.
alter function public.get_antony_closing_metrics(text, date)
  rename to get_antony_closing_metrics_internal;
revoke all on function public.get_antony_closing_metrics_internal(text, date)
  from public, anon, authenticated;
grant execute on function public.get_antony_closing_metrics_internal(text, date)
  to service_role;

create function public.get_antony_closing_metrics(
  p_period text,
  p_reference_date date default ((now() at time zone 'Europe/Berlin')::date)
)
returns table (
  period_start date,
  period_end date,
  appointments bigint,
  setter_calls bigint,
  setter_successes bigint,
  setter_success_rate numeric,
  closer_calls bigint,
  closer_second_calls bigint,
  decided_closer_calls bigint,
  closer_sales bigint,
  closer_success_rate numeric,
  new_customers bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_antony_access() then
    raise exception 'Nicht berechtigt' using errcode = '42501';
  end if;

  return query
  select *
  from public.get_antony_closing_metrics_internal(p_period, p_reference_date);
end;
$$;

revoke all on function public.get_antony_closing_metrics(text, date)
  from public, anon;
grant execute on function public.get_antony_closing_metrics(text, date)
  to authenticated;

alter function public.get_antony_open_pipeline(date)
  rename to get_antony_open_pipeline_internal;
revoke all on function public.get_antony_open_pipeline_internal(date)
  from public, anon, authenticated;
grant execute on function public.get_antony_open_pipeline_internal(date)
  to service_role;

create function public.get_antony_open_pipeline(
  p_reference_date date default ((now() at time zone 'Europe/Berlin')::date)
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_antony_access() then
    raise exception 'Nicht berechtigt' using errcode = '42501';
  end if;

  return public.get_antony_open_pipeline_internal(p_reference_date);
end;
$$;

revoke all on function public.get_antony_open_pipeline(date) from public, anon;
grant execute on function public.get_antony_open_pipeline(date) to authenticated;

alter function public.get_antony_performance_series(text, date)
  rename to get_antony_performance_series_internal;
revoke all on function public.get_antony_performance_series_internal(text, date)
  from public, anon, authenticated;
grant execute on function public.get_antony_performance_series_internal(text, date)
  to service_role;

create function public.get_antony_performance_series(
  p_period text,
  p_reference_date date default ((now() at time zone 'Europe/Berlin')::date)
)
returns table (
  bucket_index integer,
  bucket_date date,
  metric_hour smallint,
  bucket_label text,
  appointments_cumulative bigint,
  closer_appointments_cumulative bigint,
  closer_calls_cumulative bigint,
  new_customers_cumulative bigint,
  customer_time_precision text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_antony_access() then
    raise exception 'Nicht berechtigt' using errcode = '42501';
  end if;

  return query
  select *
  from public.get_antony_performance_series_internal(p_period, p_reference_date);
end;
$$;

revoke all on function public.get_antony_performance_series(text, date)
  from public, anon;
grant execute on function public.get_antony_performance_series(text, date)
  to authenticated;

alter function public.get_latest_weekly_review()
  rename to get_latest_weekly_review_internal;
revoke all on function public.get_latest_weekly_review_internal()
  from public, anon, authenticated;
grant execute on function public.get_latest_weekly_review_internal()
  to service_role;

create function public.get_latest_weekly_review()
returns table (
  week_start date,
  week_end date,
  content text,
  generated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_antony_access() then
    raise exception 'Nicht berechtigt' using errcode = '42501';
  end if;

  return query
  select * from public.get_latest_weekly_review_internal();
end;
$$;

revoke all on function public.get_latest_weekly_review() from public, anon;
grant execute on function public.get_latest_weekly_review() to authenticated;

-- Der optionale Zielplan gehoert ebenfalls zur Antony-Vollansicht. Beide
-- freigegebenen Konten koennen nur ihre jeweils eigenen Planwerte lesen und
-- bearbeiten; alle anderen Konten sehen keine Zeile und koennen keine anlegen.
drop policy if exists antony_performance_goals_owner_read
  on public.antony_performance_goals;
create policy antony_performance_goals_owner_read
on public.antony_performance_goals for select
to authenticated
using (
  owner_user_id = (select auth.uid())
  and (select public.has_antony_access())
);

drop policy if exists antony_performance_goals_leads_insert
  on public.antony_performance_goals;
create policy antony_performance_goals_leads_insert
on public.antony_performance_goals for insert
to authenticated
with check (
  owner_user_id = (select auth.uid())
  and (select public.has_antony_access())
);

drop policy if exists antony_performance_goals_leads_update
  on public.antony_performance_goals;
create policy antony_performance_goals_leads_update
on public.antony_performance_goals for update
to authenticated
using (
  owner_user_id = (select auth.uid())
  and (select public.has_antony_access())
)
with check (
  owner_user_id = (select auth.uid())
  and (select public.has_antony_access())
);

drop policy if exists antony_performance_goals_leads_delete
  on public.antony_performance_goals;
create policy antony_performance_goals_leads_delete
on public.antony_performance_goals for delete
to authenticated
using (
  owner_user_id = (select auth.uid())
  and (select public.has_antony_access())
);

commit;
