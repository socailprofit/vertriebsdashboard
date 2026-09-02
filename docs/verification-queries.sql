-- Manueller Abgleich eines importierten Tages gegen Close.
-- Im Supabase SQL Editor ausführen, Abschnitte einzeln markieren und starten.
-- Für einen anderen Tag alle Vorkommen von '2026-09-01' ersetzen.
-- Die Ergebnisse bleiben im Supabase-Dashboard; sie gehören nicht in Git,
-- nicht in Actions-Logs und nicht in den Chat.

-- 1. Lief der Sync-Lauf sauber durch?
select status, started_at, completed_at, fetched_records, upserted_records,
       metadata ->> 'mode' as mode, metadata -> 'warnings' as warnings
from public.sync_runs
order by started_at desc
limit 5;

-- 2. Sind alle vier Ebenen gefüllt?
select (select count(*) from public.close_raw_activities)    as rohdaten,
       (select count(*) from public.close_activity_facts)    as fakten,
       (select count(*) from public.close_opportunity_facts) as deals,
       (select count(*) from public.daily_sales_metrics)     as tageskennzahlen;

-- 3. Die Kennzahlen pro Person. Diese Zahlen gegen Close zählen.
select p.display_name,
       m.calls_gross                        as anrufe_brutto,
       m.calls_net                          as anrufe_netto,
       round(m.talk_seconds / 60.0, 1)      as gespraechszeit_minuten,
       m.gatekeeper_contacts                as vorzimmer_kontakte,
       m.connected_calls                    as durchstellungen,
       m.direct_decision_maker_calls        as direkte_entscheider,
       m.decision_maker_contacts            as entscheider_gesamt,
       m.appointments                       as termine,
       m.deals_won                          as deals,
       m.revenue_cents / 100.0              as umsatz_euro,
       m.newsletters                        as newsletter
from public.daily_sales_metrics m
join public.sales_people p on p.id = m.sales_person_id
where m.metric_date = '2026-09-01'
order by p.sort_order;

-- 4. Die Quoten aus dem Mapping-Dokument, aus denselben Zahlen berechnet.
select p.display_name,
       round(100.0 * m.connected_calls / nullif(m.gatekeeper_contacts, 0), 1)  as durchstellquote_prozent,
       round(100.0 * m.decision_maker_contacts / nullif(m.calls_net, 0), 1)    as entscheiderquote_prozent,
       round(100.0 * m.appointments / nullif(m.decision_maker_contacts, 0), 1) as terminquote_prozent
from public.daily_sales_metrics m
join public.sales_people p on p.id = m.sales_person_id
where m.metric_date = '2026-09-01'
order by p.sort_order;

-- 5. Gegenprobe: Stimmen die Tageskennzahlen mit den Einzelfakten überein?
--    Weicht etwas ab, liegt der Fehler in recalculate_daily_sales_metrics,
--    nicht im Mapping.
select p.display_name,
       count(*) filter (where f.calls_gross > 0) as fakten_mit_brutto_call,
       sum(f.calls_gross)                        as summe_brutto,
       sum(f.calls_net)                          as summe_netto,
       sum(f.appointments)                       as summe_termine
from public.close_activity_facts f
join public.sales_people p on p.close_user_id = f.close_user_id
where f.metric_date = '2026-09-01'
group by p.display_name, p.sort_order
order by p.sort_order;

-- 6. Wurde nichts außerhalb des Berichtstags gespeichert?
select min(occurred_at) as frueheste, max(occurred_at) as spaeteste, count(*) as anzahl
from public.close_raw_activities;

-- 7. Kennt das Mapping alle Auswahlwerte, die Close tatsächlich liefert?
--    Das ist die riskanteste Stelle: Beim Gatekeeper zählt nur exakt
--    '✅ Durchgestellt' als Durchstellung, beim Entscheider nur zwei bestimmte
--    Werte als Termin. Eine umbenannte oder zusätzliche Variante würde
--    stillschweigend als null zählen.
--
--    Freitextfelder sind ausgeschlossen — nur Werte bis 60 Zeichen aus Feldern
--    mit höchstens 25 Varianten, also Auswahllisten. So tauchen hier keine
--    Kundeninhalte auf, sondern nur die Bezeichner der Auswahlwerte.
with werte as (
  select kv.key as feld, kv.value #>> '{}' as wert
  from public.close_raw_activities r,
       lateral jsonb_each(r.payload) kv
  where r.activity_type = 'custom_activity'
    and kv.key like 'custom.%'
    and jsonb_typeof(kv.value) = 'string'
), gezaehlt as (
  select feld, wert, count(*) as anzahl
  from werte
  where length(wert) <= 60
  group by feld, wert
)
select feld, wert, anzahl
from gezaehlt
where feld in (select feld from gezaehlt group by feld having count(*) <= 25)
order by feld, anzahl desc;

-- 8. Stimmen die Regeln für Brutto und Netto?
--    Brutto = ausgehend mit endgültigem Status (completed, no-answer, busy,
--    failed, timeout). Netto = zusätzlich status 'completed' und
--    disposition 'answered'. Diese Aufstellung zeigt, welche Kombinationen
--    real vorkommen — darunter auch solche, die die Regel bewusst ausschließt.
select payload ->> 'direction'   as richtung,
       payload ->> 'status'      as status,
       payload ->> 'disposition' as ergebnis,
       count(*)                  as anzahl
from public.close_raw_activities
where activity_type = 'call'
group by 1, 2, 3
order by 4 desc;
