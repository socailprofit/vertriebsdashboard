begin;

-- The linked Close report is a status-change report, not a booking cohort or
-- proof that a scheduled conversation took place. Only observed transitions.
create table private.antony_status_definitions (
 status_id text primary key, label text not null, metric_key text unique, sort_order integer not null
);
alter table private.antony_status_definitions enable row level security;
revoke all on private.antony_status_definitions from public,anon,authenticated;
insert into private.antony_status_definitions(status_id,label,metric_key,sort_order) values
 ('stat_QpBGYOKwH94EYWTSC8ISXZcOdKxIs0uLusOqDLVAqzK','-----📞  Opening 📞----',null,0),
 ('stat_7w1SX9uj3iAImPe4FmyimxAQcJMZKD5sscHrpmSjbWw','☎️ 1.0 Nicht erreicht (⛔️1)',null,1),
 ('stat_2no5jVAVLlf4mBcyMR4wUPXQFjV9RN8ZIcgPurW1JmW','☎️ 1.0 Nicht erreicht (⛔️3)',null,2),
 ('stat_lCm7ybmHlJnPpdrOCcMjNmjDpEw70s44pxYxp8VhXyz','☎️ 1.0 Nicht erreicht (⛔️6)',null,3),
 ('stat_k4cabNLlsqKQCJJOQH0P06EM795lfCqUShwLol9Iudf','☎️ 1.0 Nicht erreicht (⛔️14)',null,4),
 ('stat_TrGMsCTpSVg7AgK1IkpXgtJwQgN1bEn0z8hJcHPKOAp','🎮 2.0 Gatekeeper FU (⛔️2)',null,5),
 ('stat_TT7ZY80V8cD5UGQoDivLX2MRJkxEfE0LlDP1U5dNIk2','🎮 2.1 Gatekeeper FU (⛔️7)',null,6),
 ('stat_OIPjbMP348RDNttNPZGnJnoRgmGHaVOPhX4pJzI323e','🎮 2.2 Gatekeeper FU (⛔️14)',null,7),
 ('stat_AIyQBiXjKn0iUf2BUap3xKp0Hlq04imQFyb1DCuHiOv','🎮 2.3 Gatekeeper FU (⛔️1 Monat)',null,8),
 ('stat_PFrybRbdPiBhujhOMQkt4AbQyDD9001Yewwp4qbUs7t','🎮 2.4 Gatekeeper FU (⛔️3 Monate)',null,9),
 ('stat_SjOITy2g06G1XuiqQbJtEDIkzUBk87zQqoHtX2wjugi','🔄 3.0 Entscheider Follow Up - 2 Wochen',null,10),
 ('stat_aWLzlkmD7MiOigCdPkWjWJRMdnyBXuz2k0my1qiSdyC','🔄 3.0 Entscheider Follow Up - 4 Wochen',null,11),
 ('stat_jsOQpi6L4TAMdvwW3Zy15BjV0opmXxOcFmGQgQQIbSt','🔄 3.0 Entscheider Follow Up - 2 Monate',null,12),
 ('stat_j4rk74qtbMeLar3jxI1FyuHzKhXZBCQd7IInpTf0ldv','🔄 3.0 Entscheider Follow Up - 3 Monate',null,13),
 ('stat_2CSCvCsUhtTK0uWRAtLMHJzJLcpT3SwZ9YRmsXQ4dXs','🔄 3.0 Entscheider Follow Up - 6 Monate',null,14),
 ('stat_Bo9KBFViTrdAlKxJaSblfNcnB90ikOzf5g4ARS82mXb','-----🏅 Setting 🏅-----','setting',15),
 ('stat_8ugtaHvwvKH3hIELdeQUqwUExa4Hn4ipsYQUuRvEfAm','🔎 1.0 Setter Follow Up (⛔️12W)','setter_followup',16),
 ('stat_d9hxREiCT5xmQHv7HbfzeyBmeVHoZYUzkMXuwzPiIve','⭐️ 2.0 Goldstandard Follow Up (⛔️1W)','gold_followup',17),
 ('stat_9z5zqirMleW4DbhYjsmZnV96jexVlXiYXU3yqIR8KzZ','🔄 No Show - Setting','setter_no_show',18),
 ('stat_v6fo1NvqjwqsIIzUS9kNDGVIJVfcDxTxYDXwpqE4gpn','-----💰 Closing 💰-----','closing',19),
 ('stat_cD0BJbQkdi32yVVjypYBOeXYyRnHBZKrSuJYhyzWory','💎 1.0 - Verkauft - Neukunde','sold',20),
 ('stat_ohblHuUMB0T7CwMfQSZhu0xWc2GDGaOEtCYOHeMMA6c','🔥 2.0 - CC2 Nachgespräch','cc2',21),
 ('stat_BWTMuauBHXSRHbOXjof5VxjjRUoZ3EtYjpxqxoYn0dH','⭐️ 3.0 Angebotsphase','offer',22),
 ('stat_13rPYib4kw9kmCqcrcVNysFD028WcuKwxQjH6syd0w6','🔄 No Show - Closer','closer_no_show',23),
 ('stat_RsEss7zujz6NG1JzYGvGexU4lLlii2GQjA8pX1GuzGP','💸 3.0 - Verlängerung/Upsell',null,24),
 ('stat_SPNvi34PmlJBYNre2CJh12Yc78H6si1jYvNyhxarxwS','👀 4.0 - Nicht Verkauft Follow-Up (⛔️12W)','not_sold_followup',25),
 ('stat_fxUuK3aBI8gbIroKMKC968L0KaywDctYWRPS9Bju4Hz','💎 5.0 - Verkauft - Upsell/Verlängerung',null,26),
 ('stat_LINEgFvzsc81hTGQPM50oNCYO8X5KVC5pWDE1VdhjGM','------------------------------------',null,27),
 ('stat_bzK4Er8v6Vc7gwHmcZusqKhEHLUHBVdLsbyBGyK32B3','💎 High Potential',null,28),
 ('stat_QiIMffvBJTn6xAJFROrTt8Ottfgv5FL5wAgIT8wcqIh','⌛ Low Potential (⛔️16W)',null,29),
 ('stat_2BTmx0RD1QbaLrh8TXMOFgVI5DOYOKgSLqMT8DwzHau','🔄 Anbahnung Erfolglos (⛔️8W)',null,30),
 ('stat_P1L8WuHSs14kYHbMuTRYQtuD98mjJIXMn9dnQNmEWCT','❌ Disqualifiziert',null,31),
 ('stat_YUowgd2VWj2MkiVND5OvtBoHKxj539V6byy1z8y9xQJ','🚫 Nummer Prüfen',null,32),
 ('stat_DTeGCBZ1wzKChXRwf30EF8CyNDwV2yctsFEh4oCai9z','🟦 LinkedIn anschreiben',null,33),
 ('stat_3qEHyFs8JnaD5vhNtIfB5ngfx8hFgHCFltJdYkcnARC','🛑LinkedIn angeschrieben (⛔16W)',null,34),
 ('stat_JthZkvb6qJUH5ui812KI7ERasnFkQh35AJ8yzR5xNJ5','💁‍♂️ Empfehlung',null,35);

create function public.get_antony_status_report(p_period text,p_reference_date date default ((now() at time zone 'Europe/Berlin')::date))
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $function$
declare
 v_snapshot timestamptz;
 v_cutoff timestamptz;
 v_start date;
 v_end date;
 v_result jsonb;
begin
 if auth.uid() is null or not public.has_antony_access() then
  raise exception 'Nicht berechtigt' using errcode='42501';
 end if;
 if p_period is null or p_period not in ('day','week','month','trend') or p_reference_date is null then
  raise exception 'Ungültiger Zeitraum' using errcode='22023';
 end if;
 select snapshot_started_at into v_snapshot from public.close_reconciliation_state where resource='funnel';
 if v_snapshot is null then raise exception 'Statusdaten noch nicht synchronisiert' using errcode='55000'; end if;
 v_cutoff:=least(now(),v_snapshot,((p_reference_date+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond');
 v_end:=(v_cutoff at time zone 'Europe/Berlin')::date;
 v_start:=case p_period when 'day' then p_reference_date
  when 'week' then date_trunc('week',p_reference_date::timestamp)::date
  when 'month' then date_trunc('month',p_reference_date::timestamp)::date
  when 'trend' then (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end;
 -- The source sync began its complete lead-status history on 1 July 2026.
 -- Never silently turn unavailable earlier history into zero performance.
 if v_start<'2026-07-01'::date then raise exception 'Statushistorie erst ab 01.07.2026 verfügbar' using errcode='22023'; end if;

 with events as materialized (
  select e.source_event_id,e.lead_id,e.occurred_at,e.previous_status,e.new_status,
   coalesce(l.display_name,e.lead_id) lead_name,
   coalesce(old.label,'Anderer Close-Status') previous_label,
   coalesce(new.label,'Anderer Close-Status') new_label
  from public.close_funnel_events e
  left join private.antony_status_definitions old on old.status_id=e.previous_status
  left join private.antony_status_definitions new on new.status_id=e.new_status
  left join public.close_funnel_leads l on l.lead_id=e.lead_id
  where e.source_kind='lead_status_change' and e.is_current and e.withdrawn_at is null
   and e.previous_status is distinct from e.new_status
   and e.occurred_at >= (v_start::timestamp at time zone 'Europe/Berlin')
   and e.occurred_at <= v_cutoff
   and (old.metric_key is not null or new.metric_key is not null)
 ), status_rows as (
  select d.status_id,d.label,d.metric_key,d.sort_order,
   count(distinct e.lead_id) filter(where e.new_status=d.status_id) entered_leads,
   count(distinct e.lead_id) filter(where e.previous_status=d.status_id) left_leads,
   count(*) filter(where e.new_status=d.status_id) entered_events,
   count(*) filter(where e.previous_status=d.status_id) left_events
  from private.antony_status_definitions d
  left join events e on e.new_status=d.status_id or e.previous_status=d.status_id
  where d.metric_key is not null group by d.status_id
 ), transitions as (
  select previous_status,new_status,previous_label,new_label,count(*) events,count(distinct lead_id) leads
  from events group by previous_status,new_status,previous_label,new_label
 )
 select jsonb_build_object(
  'version','2026-09-09.historical-statuses','period',jsonb_build_object('type',p_period,'start',v_start,'end',v_end),
  'data_as_of',v_snapshot,'cutoff',v_cutoff,'coverage_start','2026-07-01',
  'statuses',(select coalesce(jsonb_agg(to_jsonb(s) order by sort_order),'[]'::jsonb) from status_rows s),
  'transitions',(select coalesce(jsonb_agg(to_jsonb(t) order by previous_status,events desc,new_status),'[]'::jsonb) from transitions t),
  'events',(select coalesce(jsonb_agg(to_jsonb(e) order by occurred_at,source_event_id),'[]'::jsonb) from events e)
 ) into v_result;
 return v_result;
end;
$function$;
revoke all on function public.get_antony_status_report(text,date) from public,anon;
grant execute on function public.get_antony_status_report(text,date) to authenticated;
comment on function public.get_antony_status_report(text,date) is
 'Historical Setting-to-Sold lead status changes. Unique leads and repeated transitions are separate. No calendar, booking, cohort, forecast or opportunity fallback. Leadership authorization required.';
commit;
