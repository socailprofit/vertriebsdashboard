begin;

-- Vorlaeufige Freigabe zum Testen: Jeder vollstaendig eingerichtete
-- Dashboard-Nutzer darf den fertigen Reviewtext lesen. Anonym bleibt der RPC
-- gesperrt; die gespeicherten Fakten und der Modellinput bleiben service-only.
create or replace function public.get_latest_weekly_review()
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
  if auth.uid() is null or not public.has_dashboard_access() then
    raise exception 'Nicht berechtigt' using errcode = '42501';
  end if;

  return query
  select r.week_start, r.week_end, r.content, r.generated_at
  from public.weekly_reviews r
  where r.status = 'completed'
  order by r.week_start desc
  limit 1;
end;
$$;

revoke all on function public.get_latest_weekly_review() from public, anon;
grant execute on function public.get_latest_weekly_review() to authenticated;

-- Es werden weder Fragen noch Antworten gespeichert. Die Tabelle protokolliert
-- lediglich Nutzer-ID und Zeitpunkt, damit ein kompromittiertes internes Konto
-- nicht unbegrenzt kostenpflichtige Modellaufrufe ausloesen kann.
create table public.kpi_assistant_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);

comment on table public.kpi_assistant_usage is
  'Server-only quota log for the KPI assistant; stores no questions, answers, KPI payloads, or model output.';

create index kpi_assistant_usage_user_requested_at_idx
  on public.kpi_assistant_usage (user_id, requested_at desc);

alter table public.kpi_assistant_usage enable row level security;
revoke all on public.kpi_assistant_usage from public, anon, authenticated;
grant select, insert, delete on public.kpi_assistant_usage to service_role;

-- Der Aufruf ist pro Nutzer und Berliner Kalendertag atomar. -1 bedeutet,
-- dass das Tageslimit bereits erreicht war; 0 ist der letzte erlaubte Aufruf.
create or replace function public.reserve_kpi_assistant_request(
  p_user_id uuid,
  p_daily_limit integer default 20
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_used integer;
begin
  if p_user_id is null or p_daily_limit < 1 or p_daily_limit > 100 then
    raise exception 'Ungueltige Quotenreservierung' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || v_today::text, 0)
  );

  delete from public.kpi_assistant_usage
  where requested_at < now() - interval '90 days';

  select count(*)::integer into v_used
  from public.kpi_assistant_usage u
  where u.user_id = p_user_id
    and (u.requested_at at time zone 'Europe/Berlin')::date = v_today;

  if v_used >= p_daily_limit then
    return -1;
  end if;

  insert into public.kpi_assistant_usage (user_id) values (p_user_id);
  return p_daily_limit - v_used - 1;
end;
$$;

revoke all on function public.reserve_kpi_assistant_request(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_kpi_assistant_request(uuid, integer)
  to service_role;

commit;
