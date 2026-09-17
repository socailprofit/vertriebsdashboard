begin;
-- pg_cron dispatches a few seconds after the minute boundary. Include the
-- entire 17:00 minute for the final tick, but never 17:05 or later.
create or replace function public.close_sync_business_hours(p_at timestamptz)
returns boolean language sql immutable set search_path='' as $$
 select extract(isodow from p_at at time zone 'Europe/Berlin') between 1 and 5
 and (p_at at time zone 'Europe/Berlin')::time >= time '07:30'
 and (p_at at time zone 'Europe/Berlin')::time < time '17:01';
$$;
revoke all on function public.close_sync_business_hours(timestamptz) from public,anon,authenticated;
commit;
