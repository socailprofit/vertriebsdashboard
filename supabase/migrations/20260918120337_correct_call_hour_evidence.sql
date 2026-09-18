begin;
-- Read-only reporting repair. Keep source timestamps, stored KPI facts, access
-- controls and all absolute call/appointment counts unchanged.
do $patch$
declare definition text; before text; after text;
begin
 definition:=pg_get_functiondef('public.get_call_hour_performance(text,date)'::regprocedure);
 before:='coalesce(sum(f.calls_net), 0)::bigint as calls_net,';
 after:=$new$coalesce(sum(f.calls_net), 0)::bigint as calls_net,
      count(*) filter(where f.calls_net=1 and coalesce(r.payload->>'outcome_id','') not in
        ('outcome_030sp0X2TRtdT8YPJfqwWS','outcome_030spLYZrlWBQ9kEiPfudv'))::bigint as productive_count,$new$;
 if position('as productive_count,' in definition)=0 then
  if position(before in definition)=0 then raise exception 'Unexpected hour aggregate';end if;
  definition:=replace(definition,before,after);
  before:=$old$greatest(
        a.calls_net - a.mailbox_calls - a.outside_business_hours_calls,
        0::bigint
      ) as productive_calls$old$;
  if position(before in definition)=0 then raise exception 'Unexpected productive-call formula';end if;
  execute replace(definition,before,'a.productive_count as productive_calls');
 end if;
 definition:=pg_get_functiondef('public.get_call_hour_report(text,date)'::regprocedure);
 if position('as opening_activities' in definition)=0 then
  before:='select slug, metric_hour,';
  if position(before in definition)=0 then raise exception 'Unexpected hour diagnostics';end if;
  definition:=replace(definition,before,'select slug, metric_hour, count(*) as opening_activities,');
  before:='''direct_decision_maker_calls'', coalesce(c.direct_decision_maker_calls, 0),';
  if position(before in definition)=0 then raise exception 'Unexpected hour report payload';end if;
  execute replace(definition,before,'''opening_activities'', coalesce(c.opening_activities, 0), '||before);
 end if;
end;$patch$;
commit;
