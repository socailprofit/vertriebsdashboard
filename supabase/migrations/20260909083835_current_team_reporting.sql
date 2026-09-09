begin;
-- Only the current dashboard team is a personal attribution target.
create or replace function public.get_close_opener_internal(p_lead_id text) returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select case
 when l.lead_source in ('LinkedIn','Inbound LinkedIn Ads','LinkedIn Follow Up') then 'linkedin'
 when p.slug in ('michael','felix','antony') then p.slug
 when nullif(l.opener_close_user_id,'') is not null then 'outside_current_team'
 else 'unassigned' end from public.close_funnel_leads l
 left join public.sales_people p on p.close_user_id=l.opener_close_user_id where l.lead_id=p_lead_id),'unassigned');
$$;
create or replace function public.get_close_opener_labels_internal() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('michael','Michael Giesbrecht','felix','Felix Wenk','antony','Antony Rigone',
 'linkedin','LinkedIn','unassigned','Opener fehlt','outside_current_team','Kein aktueller Team-Opener');
$$;
delete from public.close_opener_directory d where not exists(select 1 from public.sales_people p where p.close_user_id=d.close_user_id and p.slug in ('michael','felix','antony'));
revoke all on function public.get_close_opener_internal(text),public.get_close_opener_labels_internal() from public,anon,authenticated;
grant execute on function public.get_close_opener_internal(text),public.get_close_opener_labels_internal() to service_role;
commit;
