-- Additive diagnosis only: retain every existing call KPI and denominator.
-- CEO unavailable alone does not prove a direct dial without a gatekeeper.
begin;
create or replace function public.get_transfer_breakdown(p_period text,p_reference_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_start date;v_end date;v_result jsonb;
begin
 if auth.uid() is null or not public.has_dashboard_access() then raise exception 'Nicht berechtigt' using errcode='42501';end if;
 if p_period is null or p_reference_date is null or p_period not in ('day','week','month','trend') then raise exception 'Invalid period' using errcode='22023';end if;
 v_start:=case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date when 'month' then date_trunc('month',p_reference_date::timestamp)::date else (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end;
 v_end:=case when p_period='week' then least(v_start+4,p_reference_date) else p_reference_date end;
 with entries as (
 select p.slug,f.gatekeeper_contacts,f.connected_calls,f.decision_maker_contacts,
 coalesce(r.payload->>'custom.cf_8Bjba56AJvfLXwNKJwhjVJwSmCdaHBlTVyH25kxp3M1',r.payload->>'custom.cf_cQiYFFuU9Cz20rbmDRy4qQiNYftCi4PZ6bMqCBPQdLB','') result,
 coalesce(r.payload->>'custom.cf_LBuW6DB7vmgifhe2JUasZIhYvrOIjcAd7xB8hzYQrJ9',r.payload->>'custom.cf_cCwSCrUsnKXzbenn1zkdqrjNIjM6ewkGgpdj4w4Yb4c','') decision_result
 from public.close_activity_facts f join public.close_raw_activities r on r.close_activity_id=f.source_activity_id join public.sales_people p on p.close_user_id=f.close_user_id
 where f.occurred_at<=public.get_sales_data_as_of_internal() and f.metric_date between v_start and v_end and r.payload->>'custom_activity_type_id' in ('actitype_3YiimGlbRMzQxr2O3hPKHJ','actitype_38qU8FYNxY0WkWAy66Uc65')
 ), counts as (select slug,count(*) activities,sum(gatekeeper_contacts) evaluated,sum(connected_calls) transferred,
 count(*) filter(where result='Nicht durchgestellt') rejected,count(*) filter(where result='E-Mail senden') email_requested,
 count(*) filter(where result='Kein Interesse') no_interest,count(*) filter(where result in ('CEO nicht erreichbar','GF nicht erreichbar')) unavailable,
 count(*) filter(where result='🛑 Kein Gatekeeper') direct,
 count(*) filter(where result='🛑 Kein Gatekeeper' and decision_maker_contacts>0) direct_reached,
 count(*) filter(where result='🛑 Kein Gatekeeper' and decision_maker_contacts=0 and decision_result in ('CEO nicht erreichbar','GF nicht erreichbar','Nicht erreicht','Nicht erreichbar','Keine Antwort')) direct_not_reached,
 count(*) filter(where result='🛑 Kein Gatekeeper' and decision_maker_contacts=0 and decision_result not in ('CEO nicht erreichbar','GF nicht erreichbar','Nicht erreicht','Nicht erreichbar','Keine Antwort')) direct_unknown,
 count(*) filter(where result in ('CEO nicht erreichbar','GF nicht erreichbar') and decision_maker_contacts=0) unreachable_route_unknown,
 count(*) filter(where result not in ('✅ Durchgestellt','Nicht durchgestellt','E-Mail senden','Kein Interesse','CEO nicht erreichbar','GF nicht erreichbar','🛑 Kein Gatekeeper')) unknown,
 count(*) filter(where result in ('CEO nicht erreichbar','GF nicht erreichbar') and decision_maker_contacts>0) conflicting_results
 from entries group by slug)
 select coalesce(jsonb_agg(to_jsonb(c) order by c.slug),'[]'::jsonb) into v_result from counts c;return v_result;
end;$$;
revoke all on function public.get_transfer_breakdown(text,date) from public,anon;
grant execute on function public.get_transfer_breakdown(text,date) to authenticated;
commit;
