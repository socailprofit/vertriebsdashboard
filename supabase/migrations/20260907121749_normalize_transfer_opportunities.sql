begin;
-- Canonical denominator for transfer performance. Unknown outcomes fail closed.
create or replace function public.is_transfer_opportunity(p_result text)
returns boolean language sql immutable set search_path = ''
as $$ select coalesce(p_result in ('✅ Durchgestellt','Nicht durchgestellt','E-Mail senden','Kein Interesse'),false); $$;
revoke all on function public.is_transfer_opportunity(text) from public,anon,authenticated;
grant execute on function public.is_transfer_opportunity(text) to service_role;

create or replace function public.enforce_transfer_opportunity()
returns trigger language plpgsql set search_path = ''
as $$
declare raw jsonb; result text; activity_type text;
begin
 if new.source_type = 'custom_activity' then
   select payload into raw from public.close_raw_activities where close_activity_id=new.source_activity_id;
   activity_type := raw->>'custom_activity_type_id';
   if activity_type in ('actitype_3YiimGlbRMzQxr2O3hPKHJ','actitype_38qU8FYNxY0WkWAy66Uc65') then
     result := case when activity_type='actitype_3YiimGlbRMzQxr2O3hPKHJ'
       then raw->>'custom.cf_8Bjba56AJvfLXwNKJwhjVJwSmCdaHBlTVyH25kxp3M1'
       else raw->>'custom.cf_cQiYFFuU9Cz20rbmDRy4qQiNYftCi4PZ6bMqCBPQdLB' end;
     new.gatekeeper_contacts := case when public.is_transfer_opportunity(result) then 1 else 0 end;
     new.connected_calls := case when result='✅ Durchgestellt' then 1 else 0 end;
   end if;
 end if;
 return new;
end;
$$;
revoke all on function public.enforce_transfer_opportunity() from public,anon,authenticated;
create trigger enforce_transfer_opportunity before insert or update
 on public.close_activity_facts for each row execute function public.enforce_transfer_opportunity();

-- Re-evaluate existing facts using the very same guard used by future imports.
update public.close_activity_facts f set gatekeeper_contacts=f.gatekeeper_contacts
where f.source_type='custom_activity'
 and exists(select 1 from public.close_raw_activities r where r.close_activity_id=f.source_activity_id
   and r.payload->>'custom_activity_type_id' in ('actitype_3YiimGlbRMzQxr2O3hPKHJ','actitype_38qU8FYNxY0WkWAy66Uc65'));

-- Change only these two metrics, retaining all other values and timestamps.
update public.daily_sales_metrics m set
 gatekeeper_contacts=coalesce((select sum(f.gatekeeper_contacts) from public.close_activity_facts f
   join public.sales_people p on p.close_user_id=f.close_user_id
   where p.id=m.sales_person_id and f.metric_date=m.metric_date),0),
 connected_calls=coalesce((select sum(f.connected_calls) from public.close_activity_facts f
   join public.sales_people p on p.close_user_id=f.close_user_id
   where p.id=m.sales_person_id and f.metric_date=m.metric_date),0)
where m.metric_date >= (date_trunc('month',now() at time zone 'Europe/Berlin') - interval '2 months')::date;

update public.monthly_kpi_snapshots m set
 gatekeeper_contacts=coalesce((select sum(d.gatekeeper_contacts) from public.daily_sales_metrics d
   where d.metric_date>=m.month_start and d.metric_date<(m.month_start+interval '1 month')::date),0),
 connected_calls=coalesce((select sum(d.connected_calls) from public.daily_sales_metrics d
   where d.metric_date>=m.month_start and d.metric_date<(m.month_start+interval '1 month')::date),0)
where m.month_start >= (date_trunc('month',now() at time zone 'Europe/Berlin')-interval '2 months')::date
 and m.month_start < date_trunc('month',now() at time zone 'Europe/Berlin')::date;
commit;
