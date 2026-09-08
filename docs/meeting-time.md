# Terminzeit und tatsächlicher Datenstand

## Current Truth

- Antony verwendet für die Terminanzahl das geplante `starts_at` eines zugeordneten Close-Meetings in `Europe/Berlin`. `date_created`, die Custom-Aktivität „Termin vereinbart“ und der Sync-Zeitpunkt sind keine Ersatz-Terminzeitpunkte.
- Auf Nutzerbestätigung zählen nur Meetings mit dokumentierter Setter-Terminvereinbarung. Die bestehende Vereinbarung liefert die Lead-ID und den Terminlieferanten; zugeordnet wird der nächste zeitlich folgende Meeting-Eintrag desselben Leads. Zeitgleiche Kandidaten oder mehrere Buchungen für denselben Meeting-Eintrag bleiben als mehrdeutig ausgeschlossen. Es gibt keine Status-Deduplizierung. Erkannte Coaching-, Onboarding-, Videodreh-, Strategieberatungs- und Beratungs-Kalendereinträge sind keine Setter-Termine.
- Die bestehende Pipeline zählt weiterhin unterschiedliche Leads, während die Termin-Gesamtzahl zugeordnete Kalenderereignisse zählt. Die erste zugeordnete Terminzeit ersetzt lediglich die bisherige Erstbuchungszeit als zeitliche Pipeline-Basis. Quoten, Personenberechtigungen und Gesprächsergebnisse behalten ihre Definitionen.
- Die separaten Opening-KPIs von Michael/Felix zählen weiter das Ergebnis des Opening-Gesprächs. Diese Terminvereinbarungsquote ist keine Kalendarauslastung; sie wurde entsprechend dem begrenzten Auftrag nicht umdefiniert. In Antonys bestehender Monatsübersicht stammen auch die nach Terminlieferant aufgeteilten Terminanzahlen aus dem Meeting-Datum.
- Alle bekannten Meetings werden unabhängig von Erstell- oder Termindatum paginiert. `close_meetings` speichert ihre minimale Identität und Zeitdaten dauerhaft außerhalb der rollierenden Custom-Activity-Bereinigung. Derselbe Meeting-Datensatz erhält bei einer Verschiebung den neuen Startzeitpunkt. In einem vollständigen Snapshot nicht mehr vorhandene Einträge werden als entfernt markiert, nicht aus dem Archiv gelöscht.
- Kalendereinträge erzeugen ausschließlich Termine. Weder `upcoming` noch `completed` erzeugt einen Setter Call, Closer Call, Show, No-Show oder Verkauf. Solche Kennzahlen benötigen weiterhin die bestehenden dokumentierten Aktivitäten.
- Performance endet spätestens am Startzeitpunkt des zuletzt erfolgreich übernommenen vollständigen Close-Snapshots, zusätzlich begrenzt durch die aktuelle Serverzeit. Zukünftig datierte Custom-Aktivitäten werden nicht als Performance übernommen. Ein heutiger Bericht und sein Stundenverlauf enden am tatsächlich vorhandenen Datenstand. Bei ausdrücklich zukünftigem Stichtag sind bekannte geplante Termine abrufbar, zukünftige Gesprächsergebnisse bleiben ausgeschlossen.
- Beliebige Kalenderbereiche sind über das geschützte RPC `get_antony_meeting_metrics(start,end)` auswertbar. Start- und Enddatum sind inklusive, technisch von Berliner Mitternacht am Start bis ausschließlich Mitternacht nach dem Enddatum. `scheduled`, `elapsed` und `future` sind getrennte Terminanzahlen; `elapsed` bedeutet nur, dass der geplante Start vergangen ist, nicht dass der Teilnehmer erschienen ist.
- Layout, Beschriftungen und Filterelemente bleiben unverändert. Es wird keine neue Hochrechnung ergänzt.

| Close-Feld | Verwendung / Verlässlichkeit |
|---|---|
| `id` | Stabile Identität eines Meeting-Datensatzes, für wiederholten Sync und Updates |
| `starts_at`, `ends_at` | Explizite Terminzeit mit Zeitzone; ungültige oder fehlende Pflichtwerte brechen den Snapshot ab |
| `date_created`, `date_updated` | Quellenmetadaten, niemals als Meeting-Datum verwendet |
| `lead_id` | Verknüpfung zur dokumentierten Terminvereinbarung; ohne passende Zuordnung kein Setter-Termin |
| `user_id`, `users`, `attendees[].user_id` | Meeting-Owner/Teilnehmer; mehrdeutiger Owner wird nicht geraten |
| `contact_id`, `attendees[].contact_id` | Optionale IDs; Namen und E-Mail-Adressen werden nicht gespeichert |
| `status`, `attendees[].status` | Optionaler Kalender-/Teilnahmestatus, keine automatische Anwesenheitsbewertung |
| `calendar_event_uids` | Optional gespeichert; keine neue Deduplizierungsregel |

- Der vollständige API-Probelauf vom 08.09.2026 um 14:42 Uhr Berlin enthält 3.055 relevante Meeting-Datensätze. Start/Ende und Erstell-/Änderungszeit sind bei allen valide; alle enthalten Lead, Owner, Status und Teilnehmer. 23 Meetings liegen in der Zukunft. 388 Meetings sind einer dokumentierten Setter-Vereinbarung zugeordnet; 28 Vereinbarungen haben keinen passenden Meeting-Eintrag, 9 Zuordnungen sind mehrdeutig. Diese Gesamtzahlen betreffen die gesamte geladene Historie, nicht den September.

## Missing Context

- Close liefert in der bisherigen Custom-Terminvereinbarung keine explizite Meeting-ID. Die Zuordnung anhand Lead und zeitlicher Folge ist daher dokumentiert und bei Mehrdeutigkeit zurückhaltend; fehlende Termine werden nicht mit dem Buchungsdatum aufgefüllt.
- Meeting-Kategorien sind im untersuchten Setup nicht durch ein durchgehend gepflegtes strukturiertes Setter-/Closer-Feld gekennzeichnet. Die beobachteten Nicht-Setter-Kategorien werden ausgeschlossen; ein neuer Kalendertyp braucht eine überprüfte fachliche Zuordnung.
- Ein über Kalender hinweg dupliziertes/neu erzeugtes Meeting wird in diesem Auftrag nicht mit einem alten Statusereignis zusammengeführt. Fehlende und mehrdeutige Buchungsverknüpfungen werden in `sync_runs.metadata.calendar` ausgewiesen.
- Die Oberfläche besitzt derzeit Zeitraumtypen plus Stichtag, keinen frei wählbaren Start-Ende-Dialog. Der geprüfte freie Bereichsfilter ist im Backend verfügbar; gemäß Auftrag wurde kein UI-Element ergänzt.

## Sources

- [Close: Meeting-Felder und Status](https://developer.close.com/api/resources/activities/meetings)
- [Close: Meeting-Liste](https://developer.close.com/api/resources/activities/meetings/list)
- `supabase/functions/_shared/close-meetings.ts`, `supabase/functions/close-sync/index.ts`
- `tests/close-meetings.test.ts`, `tests/verify-meeting-time.mjs`

## Timeline

- 2026-09-08: Nutzer bestätigt ausschließlich nachweisbare Setter-Termine; Terminzeit, Zukunftsspeicherung und Datenstand werden getrennt geprüft. Automatisierte Grenzfälle umfassen Monats- und Jahreswechsel, den vollständigen Endtag, Berliner Sommer-/Winterzeit, heutige Ereignisse nach dem Sync sowie bereits gespeicherte Termine im Folgemonat.
- 2026-09-08, 14:42 Uhr Berlin: Cloud-Probelauf über `close-sync` Version 79 erfolgreich, HTTP 200, vollständige API-Paginierung und Feldabdeckung geprüft. Kein CRM-Datensatz wurde verändert.
- 2026-09-08, 14:44 Uhr Berlin: Vollständiger Cloud-Snapshot erfolgreich gespeichert. Nach Aktivierung der Kalenderzeit-Zuordnung sind alle Gesprächsergebnis-Zähler in Tag, Woche, Monat und drei Monaten identisch zum unmittelbar zuvor gelesenen Snapshot. Aktuell 17 nachweisbare September-Setter-Termine, davon 10 bis zum Datenstand und 7 zukünftig; keine Zukunfts-Performance. Monatsbericht per `EXPLAIN ANALYZE`: 1.161 ms. 88 Node-Tests und die zusätzlichen PostgreSQL-Szenarien bestehen.
