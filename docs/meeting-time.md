# Terminzeit und tatsächlicher Datenstand

## Current Truth

- Antony verwendet für die Terminanzahl das geplante `starts_at` eines zugeordneten Close-Meetings in `Europe/Berlin`. `date_created`, die Custom-Aktivität „Termin vereinbart“ und der Sync-Zeitpunkt sind keine Ersatz-Terminzeitpunkte.
- Auf Nutzerbestätigung zählen nur Meetings mit dokumentierter Setter-Terminvereinbarung. Die bestehende Vereinbarung liefert die Lead-ID und den Terminlieferanten; zugeordnet wird der nächste zeitlich folgende Meeting-Eintrag desselben Leads. Zeitgleiche Kandidaten oder mehrere Buchungen für denselben Meeting-Eintrag bleiben als mehrdeutig ausgeschlossen. Bereits nachgewiesene Zuordnungen bleiben bei unveränderter Meeting-ID erhalten, auch wenn der Termin verschoben wird. Unterschiedliche Meeting-IDs werden nicht allein wegen desselben Leads zusammengeführt. Erkannte Coaching-, Onboarding-, Videodreh-, Strategieberatungs- und Beratungs-Kalendereinträge sind keine Setter-Termine.
- Die bestehende Pipeline zählt weiterhin unterschiedliche Leads, während die Termin-Gesamtzahl zugeordnete Kalenderereignisse zählt. Die erste zugeordnete Terminzeit ersetzt lediglich die bisherige Erstbuchungszeit als zeitliche Pipeline-Basis. Diese Lead-Fortschrittsquoten bleiben von der unten definierten Meeting-Showrate getrennt; Personenberechtigungen bleiben unverändert.
- Die separaten Opening-KPIs von Michael/Felix zählen weiter das Ergebnis des Opening-Gesprächs. Diese Terminvereinbarungsquote ist keine Kalendarauslastung; sie wurde entsprechend dem begrenzten Auftrag nicht umdefiniert. In Antonys bestehender Monatsübersicht stammen auch die nach Terminlieferant aufgeteilten Terminanzahlen aus dem Meeting-Datum.
- Alle bekannten Meetings werden unabhängig von Erstell- oder Termindatum paginiert. `close_meetings` speichert ihre minimale Identität und Zeitdaten dauerhaft außerhalb der rollierenden Custom-Activity-Bereinigung. Derselbe Meeting-Datensatz erhält bei einer Verschiebung den neuen Startzeitpunkt. In einem vollständigen Snapshot nicht mehr vorhandene Einträge werden als entfernt markiert, nicht aus dem Archiv gelöscht.
- Kalendereinträge erzeugen ausschließlich Termine. Weder `upcoming` noch `completed` erzeugt einen Setter Call, Closer Call, Show, No-Show oder Verkauf. Solche Kennzahlen benötigen weiterhin die bestehenden dokumentierten Aktivitäten.
- Performance endet spätestens am Startzeitpunkt des zuletzt erfolgreich übernommenen vollständigen Close-Snapshots, zusätzlich begrenzt durch die aktuelle Serverzeit. Zukünftig datierte Custom-Aktivitäten werden nicht als Performance übernommen. Ein heutiger Bericht und sein Stundenverlauf enden am tatsächlich vorhandenen Datenstand. Bei ausdrücklich zukünftigem Stichtag sind bekannte geplante Termine abrufbar, zukünftige Gesprächsergebnisse bleiben ausgeschlossen.
- Beliebige Kalenderbereiche sind über das geschützte RPC `get_antony_meeting_metrics(start,end)` auswertbar. Start- und Enddatum sind inklusive, technisch von Berliner Mitternacht am Start bis ausschließlich Mitternacht nach dem Enddatum. `scheduled`, `elapsed` und `future` sind getrennte Terminanzahlen; `elapsed` bedeutet nur, dass der geplante Start vergangen ist, nicht dass der Teilnehmer erschienen ist.
- Die Oberfläche ergänzt eine kompakte Setter-Showrate im gewählten Zeitraum und im Drei-Monats-Rückblick. Quelle und Terminlieferant filtern diese mit; die Buchungsgruppen-Auswahl verändert ausschließlich den Lead-Fortschritt. Es wird keine neue Hochrechnung ergänzt.


### Setter-Showrate und Verschiebungen (Priorität B)

- **Showrate = nachweislich durchgeführte Meetings / bereits fällige geplante Meetings des gewählten Kalenderzeitraums.** Frühere Buchungsmonate spielen für den Nenner keine Rolle. Zukunftstermine sind separat `future` und beeinflussen weder die Quote noch negative Ergebnisse. Bei Nenner 0 bleibt die Quote leer.
- Ein Setter-Call-Nachweis muss denselben Lead haben und zeitlich zum konkreten Meeting gehören: ab geplantem Start, vor dem nächsten zugeordneten Meeting, spätestens bis zum Ende des lokalen Kalendertags des Meeting-Endes. Eine Aktivität darf nur genau einem Meeting zugeordnet sein. Mehrere passende Call-Nachweise ergeben höchstens eine Teilnahme; spätere Follow-ups an anderen Tagen werden nicht ausgeliehen. Fehlende oder mehrdeutige Nachweise bleiben `unknown`, niemals automatisch No-Show.
- Die fälligen Termine verteilen sich vollständig auf `attended`, `no_show`, `cancelled`, `rescheduled` und `unknown`. Absagen gehören zum Nenner aller fälligen Plantermine. Eine dokumentierte Absage vor dem Start zählt erst nach Fälligkeit. Ein vorzeitig dokumentierter No-Show ist kein gültiger Nachweis.
- Bei einer **eindeutigen Verschiebung derselben Close-Meeting-ID** wird der aktuelle Start ersetzt und die Buchungszuordnung beibehalten. Der alte Zeitpunkt zählt nicht zusätzlich. `close_meeting_time_history` protokolliert alten/neuen Start und Ende, Quellenänderung und Sync-Beobachtung automatisch im selben Datenbankvorgang. Unveränderte Wiederholungen erzeugen keine Revision.
- Ein alter No-Show wird nach der Verschiebung aus den Setter-Berichten ausgeschlossen. Rohaktivitäten bleiben für die Nachvollziehbarkeit bestehen. Vor der letzten Datumsänderung dokumentierte Ergebnisse werden nicht auf den neuen Termin übertragen. Die gemeinsamen Berichtsquellen gelten für Tag, Woche, Monat, drei Monate sowie Quellen-/Terminlieferantfilter und den offenen Bestand.
- Die History startet mit Einführung dieser Regel. Vergangene Änderungen, die Close vor dem ersten gespeicherten Snapshot bereits überschrieben hatte, werden nicht erfunden. Neu erzeugte Meeting-IDs ohne explizite gemeinsame Identität bleiben getrennt; keine heuristische Leadverlaufs-Deduplizierung.
- Die Kalenderbasis ist Setter-spezifisch. Bestehende Closer-/CC2-Prozessdefinitionen und tatsächliche Gesprächszahlen bleiben unverändert.

| Close-Feld | Verwendung / Verlässlichkeit |
|---|---|
| `id` | Stabile Identität eines Meeting-Datensatzes, für wiederholten Sync und Updates |
| `starts_at`, `ends_at` | Explizite Terminzeit mit Zeitzone; ungültige oder fehlende Pflichtwerte brechen den Snapshot ab |
| `date_created`, `date_updated` | Quellenmetadaten, niemals als Meeting-Datum verwendet |
| `lead_id` | Verknüpfung zur dokumentierten Terminvereinbarung; ohne passende Zuordnung kein Setter-Termin |
| `user_id`, `users`, `attendees[].user_id` | Meeting-Owner/Teilnehmer; mehrdeutiger Owner wird nicht geraten |
| `contact_id`, `attendees[].contact_id` | Optionale IDs; Namen und E-Mail-Adressen werden nicht gespeichert |
| `status`, `attendees[].status` | Kalenderende/RSVP beweisen keine Anwesenheit. Explizit abgesagte/abgelehnte Meetings können nach Fälligkeit als Absage zählen, nie automatisch als No-Show |
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
- `tests/close-meetings.test.ts`, `tests/verify-meeting-time.mjs`, `tests/verify-setter-attendance.mjs`

## Timeline

- 2026-09-08: Nutzer bestätigt ausschließlich nachweisbare Setter-Termine; Terminzeit, Zukunftsspeicherung und Datenstand werden getrennt geprüft. Automatisierte Grenzfälle umfassen Monats- und Jahreswechsel, den vollständigen Endtag, Berliner Sommer-/Winterzeit, heutige Ereignisse nach dem Sync sowie bereits gespeicherte Termine im Folgemonat.
- 2026-09-08, 14:42 Uhr Berlin: Cloud-Probelauf über `close-sync` Version 79 erfolgreich, HTTP 200, vollständige API-Paginierung und Feldabdeckung geprüft. Kein CRM-Datensatz wurde verändert.
- 2026-09-08, 14:44 Uhr Berlin: Vollständiger Cloud-Snapshot erfolgreich gespeichert. Nach Aktivierung der Kalenderzeit-Zuordnung sind alle Gesprächsergebnis-Zähler in Tag, Woche, Monat und drei Monaten identisch zum unmittelbar zuvor gelesenen Snapshot. Aktuell 17 nachweisbare September-Setter-Termine, davon 10 bis zum Datenstand und 7 zukünftig; keine Zukunfts-Performance. Monatsbericht per `EXPLAIN ANALYZE`: 1.161 ms. 88 Node-Tests und die zusätzlichen PostgreSQL-Szenarien bestehen.

- 2026-09-08, 14:52–14:53 Uhr Berlin: Erster regulärer 15-Minuten-Cron mit Meeting-Speicherung erfolgreich. Ein vor dem Termin dokumentierter Absage-/Verschiebestatus bleibt in der zeitlich zugeordneten Pipeline und im offenen Bestand erhalten; Regressionstest ergänzt. Aktuelle September-Gruppe: 3 Setter, 3 Absagen, 1 No-Show, keine ungeklärten offenen Termine vor dem Setter.

- 2026-09-08, Priorität B: Migration `20260908131505_setter_meeting_attendance`, Close-Sync Version 80. Live-Basis September: 17 geplante Meetings, 10 fällig, 7 zukünftig; 6 durchgeführt, 3 abgesagt, 1 No-Show, 0 ungeklärt; Showrate 60 %. 90 Node-Tests sowie die PostgreSQL-Szenarien zu Kalenderzeit, Showrate und bestehendem Sales-Prozess erfolgreich.
