begin;

-- Live-Aktualisierung für die Tabellen, die das Dashboard sichtbar verändern.
-- Realtime achtet auf Row Level Security: Es liefert einem Client nur
-- Änderungen an Zeilen, die er ohnehin lesen dürfte. Die bestehenden Policies
-- gelten also unverändert weiter, sync_runs erreicht weiterhin nur den Manager.
--
-- Rohdaten und Einzelfakten werden bewusst nicht veröffentlicht: Das Frontend
-- liest sie nicht, und jede importierte Zeile würde eine Nachricht erzeugen.
--
-- Das Abonnement dient als Signal zum Nachladen, nicht als Datenquelle: Views
-- lassen sich nicht abonnieren, das Dashboard liest aber über
-- dashboard_daily_metrics und die RPC-Funktionen.

alter publication supabase_realtime add table public.daily_sales_metrics;
alter publication supabase_realtime add table public.sales_targets;
alter publication supabase_realtime add table public.sync_runs;

commit;
