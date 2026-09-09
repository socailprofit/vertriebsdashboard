begin;
-- LinkedIn acquisition is a channel. Only LinkedIn Cold Calls carries a
-- variable personal Opener; performed conversations remain actor-attributed.
create or replace function public.get_close_opener_internal(p_lead_id text) returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select case when l.lead_source in ('LinkedIn','Inbound LinkedIn Ads','LinkedIn Follow Up') then 'linkedin'
 else coalesce(p.slug,nullif(l.opener_close_user_id,'')) end from public.close_funnel_leads l
 left join public.sales_people p on p.close_user_id=l.opener_close_user_id where l.lead_id=p_lead_id),'unassigned');
$$;
create or replace function public.get_close_opener_labels_internal() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(coalesce(p.slug,d.close_user_id),d.display_name),'{}'::jsonb)||jsonb_build_object('unassigned','Opener fehlt','linkedin','LinkedIn')
 from public.close_opener_directory d left join public.sales_people p on p.close_user_id=d.close_user_id;
$$;
revoke all on function public.get_close_opener_internal(text),public.get_close_opener_labels_internal() from public,anon,authenticated;
grant execute on function public.get_close_opener_internal(text),public.get_close_opener_labels_internal() to service_role;
commit;
