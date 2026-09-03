begin;

-- Bei der ersten echten Anmeldung scheiterte das Laden mit
-- "permission denied for table profiles". Grund: Row Level Security und
-- Tabellenrechte sind zwei getrennte Schichten. Die Policies regeln, welche
-- Zeilen jemand sehen darf; ob er die Tabelle überhaupt lesen darf, entscheidet
-- ein GRANT. Die Grundmigration hat die Tabellen angelegt und Policies gesetzt,
-- aber `authenticated` nie etwas gewährt — deshalb war jede Abfrage abgewiesen,
-- bevor eine Policy überhaupt geprüft wurde.
--
-- Hier steht bewusst nur, was die Oberfläche tatsächlich benutzt. Die
-- Zeilenfilterung bleibt vollständig den bestehenden Policies überlassen.

grant select on public.sales_people to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.sales_targets to authenticated;
grant select on public.sync_runs to authenticated;
grant select on public.daily_summaries to authenticated;

-- get_call_hour_performance wertet close_activity_facts aus, und diese Tabelle
-- ist für Angemeldete gesperrt und soll es bleiben: Sie enthält jede einzelne
-- Aktivität samt Lead-Bezug. Die Funktion gibt daraus nur Stundenquoten je
-- Person zurück. Sie läuft deshalb mit den Rechten ihres Eigentümers, statt die
-- Rohtabelle zu öffnen.
alter function public.get_call_hour_performance(text, date) security definer;

commit;
