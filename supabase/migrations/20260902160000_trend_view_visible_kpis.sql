begin;

-- Die Trendansicht zeigte Deals, Umsatz und die Abschlussquote — genau die drei
-- Werte, die im Dashboard vorerst nicht erscheinen — und ließ die Durchstellung
-- aus, die zu den wichtigsten Kennzahlen gehört. Auf den sichtbaren Umfang
-- umstellen: Anrufe, Vorzimmer, Durchstellungen und Termine, jeweils mit den
-- beiden Quoten, die im Mapping definiert sind.
--
-- Deals und Umsatz bleiben in daily_sales_metrics erhalten und lassen sich
-- jederzeit wieder aufnehmen, wenn der Umsatz sichtbar werden soll.

drop view if exists public.dashboard_monthly_trends;

create view public.dashboard_monthly_trends
with (security_invoker = true)
as
with months as (
  select
    (date_trunc('month', now() at time zone 'Europe/Berlin') - (month_offset * interval '1 month'))::date as month_start
  from generate_series(0, 2) as offsets(month_offset)
), aggregated as (
  select
    months.month_start,
    p.slug,
    p.display_name,
    p.color,
    p.sort_order,
    coalesce(sum(m.calls_gross), 0)::bigint as calls_gross,
    coalesce(sum(m.calls_net), 0)::bigint as calls_net,
    coalesce(sum(m.gatekeeper_contacts), 0)::bigint as gatekeeper_contacts,
    coalesce(sum(m.connected_calls), 0)::bigint as connected_calls,
    coalesce(sum(m.decision_maker_contacts), 0)::bigint as decision_maker_contacts,
    coalesce(sum(m.appointments), 0)::bigint as appointments
  from months
  cross join public.sales_people p
  left join public.daily_sales_metrics m
    on m.sales_person_id = p.id
    and m.metric_date >= months.month_start
    and m.metric_date < (months.month_start + interval '1 month')::date
  where p.active = true
  group by months.month_start, p.id, p.slug, p.display_name, p.color, p.sort_order
)
select
  month_start,
  slug,
  display_name,
  color,
  calls_gross,
  calls_net,
  gatekeeper_contacts,
  connected_calls,
  case when gatekeeper_contacts = 0 then 0
    else round((connected_calls::numeric / gatekeeper_contacts) * 100, 2)
  end as connection_rate,
  decision_maker_contacts,
  appointments,
  case when decision_maker_contacts = 0 then 0
    else round((appointments::numeric / decision_maker_contacts) * 100, 2)
  end as appointment_rate
from aggregated
order by month_start desc, sort_order;

grant select on public.dashboard_monthly_trends to authenticated;

commit;
