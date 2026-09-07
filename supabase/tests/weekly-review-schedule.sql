begin;
do $$
declare item record; rejected boolean;
begin
  if not public.is_team_review_time('2026-09-07 06:00:00+00')
     or not public.is_team_review_time('2026-10-26 08:00:00+00')
     or not public.is_team_review_time('2026-03-23 08:00:00+00')
     or not public.is_team_review_time('2026-03-30 06:00:00+00')
     or not public.is_team_review_time('2026-09-07 06:05:00+00')
     or public.is_team_review_time('2026-09-07 07:00:00+00')
     or public.is_team_review_time('2026-10-26 06:00:00+00')
     or public.is_team_review_time('2026-09-08 06:00:00+00') then
    raise exception 'Summer/winter schedule regression';
  end if;
  for item in select u.id,u.email from auth.users u join public.profiles p on p.user_id=u.id loop
    update public.profiles set must_change_password=false where user_id=item.id;
    perform set_config('request.jwt.claim.sub',item.id::text,true);
    rejected := false;
    begin
      perform public.get_latest_weekly_review();
    exception when insufficient_privilege then rejected := true;
    end;
    if rejected <> (lower(item.email) not in ('rigone@socialprofit.de','info@socialprofit.de')) then
      raise exception 'Weekly review account authorization regression';
    end if;
    update public.profiles set must_change_password=true where user_id=item.id;
    begin
      perform public.get_latest_weekly_review();
      raise exception 'Pending account reads review';
    exception when insufficient_privilege then null;
    end;
  end loop;
  if has_function_privilege('anon','public.get_latest_weekly_review()','EXECUTE')
    or has_function_privilege('authenticated','public.get_latest_weekly_review_internal()','EXECUTE') then
    raise exception 'Unexpected public/internal RPC access';
  end if;
end; $$;
select 'schedule and leadership access passed; profile changes rolled back' result;
rollback;
