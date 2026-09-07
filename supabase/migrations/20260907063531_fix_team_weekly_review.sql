begin;

create or replace function public.get_latest_weekly_review()
returns table (week_start date, week_end date, content text, generated_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_dashboard_access() or not exists (
    select 1 from auth.users u where u.id = auth.uid()
      and lower(coalesce(u.email, '')) = 'rigone@socialprofit.de'
  ) then
    raise exception 'Nicht berechtigt' using errcode = '42501';
  end if;
  return query select r.week_start, r.week_end, r.content, r.generated_at
    from public.weekly_reviews r where r.status = 'completed'
    order by r.week_start desc limit 1;
end;
$$;
revoke all on function public.get_latest_weekly_review() from public, anon;
grant execute on function public.get_latest_weekly_review() to authenticated;

-- UTC candidates cover CET and CEST. The Berlin guard selects 08:00 CEST or 09:00 CET.
-- Retries at +5/+10 minutes run only if the first attempt left no review.
create function public.is_team_review_time(p_at timestamptz)
returns boolean language sql immutable set search_path = ''
as $$
  select extract(isodow from p_at at time zone 'Europe/Berlin') = 1
    and extract(hour from p_at at time zone 'Europe/Berlin') = case
      when (p_at at time zone 'Europe/Berlin') - (p_at at time zone 'UTC') = interval '2 hours' then 8
      else 9 end
    and extract(minute from p_at at time zone 'Europe/Berlin') in (0,5,10);
$$;
revoke all on function public.is_team_review_time(timestamptz) from public, anon, authenticated;
grant execute on function public.is_team_review_time(timestamptz) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'antony_weekly_review';
select cron.schedule('antony_weekly_review', '0,5,10 6,8 * * 1', $cron$
  select net.http_post(
    url := 'https://pdobcvffnzqxtmkkpfnn.supabase.co/functions/v1/weekly-review',
    headers := jsonb_build_object('content-type','application/json','x-sync-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='CLOSE_SYNC_SECRET')),
    body := jsonb_build_object('trigger','supabase-cron'),
    timeout_milliseconds := 90000
  ) where public.is_team_review_time(now())
    and not exists (
      select 1 from public.weekly_reviews
      where week_start = date_trunc('week', now() at time zone 'Europe/Berlin')::date - 7
    );
$cron$);
commit;
