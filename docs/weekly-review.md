# Team-Wochenzusammenfassung für Antony

## Current Truth

- Der produktive Supabase-Cron startet montags um **08:00 Uhr bei Sommerzeit (CEST)** und **09:00 Uhr bei Winterzeit (CET)**, jeweils Europe/Berlin. UTC-Kandidaten 06:00 und 08:00 werden durch `is_team_review_time()` auf die richtige Ortszeit begrenzt. Die Zeitumstellungen sind getestet.
- Die Funktion analysiert die letzte abgeschlossene Vertriebswoche Montag bis Freitag sowie die Vorwoche. `get_weekly_review_kpis` aggregiert das gesamte Opening/Setting-Team und ergänzt die nachgelagerte Closing-Stufe. Keine separaten Personenbewertungen, CRM-Freitexte oder Kundendaten gehen an OpenAI.
- Es entstehen genau fünf Bulletpoints: Stärke, Funnel-Engpass, Vorwochenvergleich, nächste Priorität und konkrete Handlung. Mindestens zwei behandeln die gemeinsame Teamleistung vor dem Closing. Niedrige Grundgesamtheiten werden als Einschränkung benannt.
- Der Bericht steht als eigener Bereich im Dashboard, auch auf der Teamansicht. Die vollständig eingerichteten Konten `rigone@socialprofit.de` und `info@socialprofit.de` können ihn lesen. Andere Konten bleiben gesperrt. Beide Konten haben die Dashboard-Rolle `manager`; der interaktive KPI-Assistent bleibt für beide freigegeben.
- Supabase Auth/RLS und der eingeschränkte RPC setzen die Lesesperre serverseitig durch; interne Reviewtabellen sind für Browserkonten nicht lesbar. Freitexte werden vor HTML-Ausgabe escaped.
- Der bestehende OpenAI-Aufruf verwendet `gpt-5.4-mini-2026-03-17`, Structured Output, `store: false` und einen serverseitigen API-Schlüssel. Maximal 1600 Ausgabetokens und 60 Sekunden Timeout.
- Ein Unique-Schlüssel und eine Reservierung verhindern doppelte reguläre Modellaufrufe. Nach einem abgefangenen Fehler wird die unfertige Reservierung entfernt; der Cron versucht es fünf und zehn Minuten nach dem Solltermin erneut, falls kein Bericht/reservierter Lauf vorliegt. Fertige Berichte bleiben erhalten.
- Am 2026-09-07 wurde der erste produktive Bericht für 31.08.–04.09. erfolgreich erzeugt: HTTP 200 und fünf Punkte. Ein weiterer Aufruf wurde als bereits vorhanden übersprungen.
- Der interaktive KPI-Assistent bleibt in der Antony-Ansicht und verwendet weiterhin aktuelle Kennzahlen sowie die aggregierte Pipeline. Der Wochenbericht verwendet ausschließlich abgeschlossene Wochen; die aktuelle Pipeline-Momentaufnahme ist dort kein Modellinput mehr.

## Missing Context

- Der neue zukünftige Cron-Zeitpunkt kann erst beim nächsten regulären Montag live beobachtet werden. Die SQL-Zeitlogik einschließlich Sommer-/Winterwechsel und der reale HTTP-/OpenAI-/Speicherpfad wurden bereits getestet.
- Antonys Konto erfordert zum Prüfzeitpunkt noch die persönliche Passworteinrichtung. Die bestehende Sicherheitssperre wurde nicht aufgehoben; danach wird der Bericht für dieses Konto freigegeben.
- Ein harter Runtime-Abbruch außerhalb des abgefangenen Fehlerpfads kann eine `generating`-Reservierung zurücklassen. Diese muss administrativ untersucht werden; fertige Berichte niemals pauschal löschen.

## Sources

- `supabase/functions/weekly-review/index.ts`
- `supabase/functions/_shared/weekly-review.ts`
- `supabase/migrations/20260907063531_fix_team_weekly_review.sql`
- `supabase/migrations/20260907063906_allow_leadership_weekly_review.sql`
- `supabase/tests/weekly-review-schedule.sql`
- `tests/access-control.test.mjs`, `tests/weekly-review.test.ts`
- Produktiver HTTP-Test und Datenbankprüfung am 2026-09-07.

## Timeline

- 2026-09-04: Ursprüngliche serverseitige Reviewkette eingerichtet.
- 2026-09-07: Alten Zeitpunkt 07:10 UTC und noch nicht ausgeführten ersten Montagslauf festgestellt.
- 2026-09-07: Benutzerkorrektur umgesetzt: Sommer 08:00, Winter 09:00 deutscher Ortszeit; Teamfokus und Zugriff für beide Führungskonten ergänzt; erster Bericht erzeugt und geprüft.
