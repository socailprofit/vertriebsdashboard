begin;
create function public.get_opening_monthly_review(p_reference_date date default ((now() at time zone 'Europe/Berlin')::date))
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare v_date date;v_result jsonb;
begin
 if auth.uid() is null or not public.has_dashboard_access() then raise exception 'Nicht berechtigt' using errcode='42501';end if;
 if p_reference_date is null then raise exception 'Ungültiger Stichtag' using errcode='22023';end if;
 v_date:=least(p_reference_date,(now() at time zone 'Europe/Berlin')::date);
 with windows as (
  select (date_trunc('month',v_date::timestamp)-n*interval '1 month')::date start_date,
   least(v_date,(date_trunc('month',v_date::timestamp)-(n-1)*interval '1 month'-interval '1 day')::date) end_date,
   (date_trunc('month',v_date::timestamp)-(n-1)*interval '1 month'-interval '1 day')::date month_end
  from generate_series(0,2)n
 ), coverage as (
  select w.*,count(*) calendar_days,count(*) filter(where exists(
    select 1 from public.sync_runs r where r.status='success'
     and r.source_window_start <= (d at time zone 'Europe/Berlin')
     and r.source_window_end >= ((d+interval '1 day') at time zone 'Europe/Berlin')
   )) coverage_days
  from windows w cross join lateral generate_series(w.start_date::timestamp,w.end_date::timestamp,interval '1 day')d
  group by w.start_date,w.end_date,w.month_end
 ), metrics as (
  select to_jsonb(m)||jsonb_build_object('month_start',w.start_date,'month_end',w.end_date,
   'partial',w.end_date<w.month_end,'calls_coverage_complete',w.coverage_days=w.calendar_days,
   'calls_coverage_days',w.coverage_days,'calendar_days',w.calendar_days) row
  from coverage w cross join lateral public.get_dashboard_metrics('month',w.end_date)m
  where m.slug in ('michael','felix')
 ) select coalesce(jsonb_agg(row order by row->>'month_start',row->>'slug'),'[]'::jsonb) into v_result from metrics;
 return v_result;
end;$$;
revoke all on function public.get_opening_monthly_review(date) from public,anon;
grant execute on function public.get_opening_monthly_review(date) to authenticated;
commit;
