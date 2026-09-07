begin;
create or replace function public.get_latest_weekly_review()
returns table (week_start date, week_end date, content text, generated_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_antony_access() then
    raise exception 'Nicht berechtigt' using errcode = '42501';
  end if;
  return query select r.week_start,r.week_end,r.content,r.generated_at
    from public.weekly_reviews r where r.status='completed'
    order by r.week_start desc limit 1;
end;
$$;
revoke all on function public.get_latest_weekly_review() from public, anon;
grant execute on function public.get_latest_weekly_review() to authenticated;
commit;
