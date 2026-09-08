# Antony-Pipeline und Gesamtverlauf

## Current Truth

Die gezielte Terminzeit-Änderung vom 08.09.2026 ist in [meeting-time.md](meeting-time.md) dokumentiert: Antony verwendet das tatsächliche Kalenderdatum zugeordneter Setter-Meetings, nicht die Custom-Buchungszeit. Der Datenstand begrenzt sämtliche Gesprächs-Performance. Die folgenden Prozessregeln bleiben davon abgesehen bestehen.

- `get_antony_report(period, reference_date)` liefert Aktivitäten, Buchungsgruppe, Zeitverlauf, offenen Bestand, Monatsplanung und Drei-Monats-Rückblick in einem geschützten Datenbanksnapshot. Er verlangt `has_antony_access()`. Die zwei freigegebenen Leitungskonten behalten ihren Zugriff; andere Dashboardkonten erhalten keine Antony-Daten.
- Oben stehen Aktivitäten im ausgewählten Zeitraum. Wiederholte Gespräche sind einzelne Aktivitäten; Neukunden werden pro Lead einmal am ersten gespeicherten Neukunden-Won gezählt. Upsells und Verlängerungen sind ausgeschlossen. Ein späteres Verkaufsgespräch verschiebt diesen Won nicht in einen neuen Monat.
- Die Pipeline verfolgt dieselben terminierten Leads in zeitlicher Reihenfolge: **Termin → Setter durchgeführt → Closer terminiert → Closer durchgeführt → CC2 vereinbart (optional) → Neukunde**. Die dokumentierte Buchung bestimmt den Terminlieferanten, das erste zugeordnete Setter-Meeting das Kalenderdatum. Mehrere Gespräche desselben Leads vervielfachen diese Gruppe nicht.
- Der Endpunkt Neukunde übernimmt alle datierten Neukunden-Won dieser Buchungsgruppe, auch wenn ein separates Verkaufsergebnis als Custom-Aktivität fehlt. Seine Gesamtquote lautet Neukunden / gebuchte Leads. Fehlende Zwischenschritte werden weiterhin ausgewiesen. Die getrennten UI-Stufen Entschieden und Verkauft sowie die zusätzliche Verkaufsreihe im Graphen entfallen; Entscheidungsdaten bleiben intern für die bestehende Abschlussquote erhalten.
- CC2 steht in derselben Pipeline. Direkte CC1-Verkäufe überspringen CC2; die Entscheidungsquote verwendet deshalb alle durchgeführten Closer-Leads als Basis. Die Abschlussquote verwendet verkaufte / ausdrücklich entschiedene Leads. Offene Gespräche und CC2-Vereinbarungen sind keine verlorenen Entscheidungen.
- CC2-Details zeigen vereinbart, durchgeführt, entschieden, verkauft, offen, verloren, abgesagt, verschoben und No-Show. Eine Vereinbarung allein ist keine Durchführung. Die Durchführung benötigt einen späteren Closer Call oder ein ausdrücklich dokumentiertes CC2-Verkaufsergebnis.
- Jede Rate zeigt Zähler und Nenner. Ohne Nenner erscheint `—`, keine erfundene 0-%-Rate. Fehlende Vorstufen werden als Dokumentationslücken ausgewiesen; bestätigte Aktivitäten bleiben in den Zeitraumzahlen enthalten.
- Setter-Zahlen sind anklickbar: Datum, verantwortliche Person und Herkunft aus Buchungen des Zeitraums, früheren Buchungen oder fehlender gespeicherter Buchung. Leadqualität kann nach Quelle und Terminlieferant gefiltert werden; einzelne Quellen mit kleiner Stichprobe erhalten keine belastbare Ranglistenbewertung.
- Der offene Bestand nimmt je Lead den jüngsten eindeutigen dokumentierten Zustand: Setter ausstehend, Follow-up, verschoben, No-Show, Closer terminiert, CC2 offen oder verkauft ohne Won. Absagen, Disqualifizierungen und ausdrücklich verlorene Fälle sind geschlossen. No-Shows bleiben zur Nachbearbeitung offen. Vormonate und Alter über 14 Tage sind überlappende Marker, keine zusätzlichen Leads.
- Der kumulierte Graph zeigt Termine, Setter Calls, Closer-Termine, Closer Calls, CC2-Vereinbarungen und Neukunden. Ein Klick zeigt den Zeitpunkt und alle Werte. Tages-Won haben keine erfundene Uhrzeit.
- Die Monats-Hochrechnung extrapoliert jeden Aktivitätstyp unabhängig nach Werktagstempo. Der optionale Zielrechner verwendet zusammengehörige Übergänge und berücksichtigt Entscheidungs- und Won-Bestätigungsrate. Modellwerte sind keine gebuchten Umsätze.
- Vorzimmer-Aufschlüsselungen zählen nur auswertbare Gatekeeper-Ergebnisse. GF/CEO nicht erreichbar und direkte Entscheiderkontakte bleiben außerhalb der Durchstellquote. Widersprüchliche CRM-Auswahlen werden markiert.
- Alle Regeln berechnen sich aus den automatisch synchronisierten Fakten. Es gibt keine manuelle Liste nachgereichter Leads. Zeiträume und Quellenfilter verwenden dieselben SQL-Regeln. Späte Ergebnisse älterer Buchungen erscheinen am Ereignisdatum im aktuellen Zeitraum.
- Realtime-Meldungen des vollständigen Abgleichs werden nach einer Sekunde Ruhe gebündelt. Hintergrundaktualisierungen laufen nacheinander; Änderungen während einer laufenden Abfrage führen anschließend genau zu einer weiteren Aktualisierung. Das verhindert eine Abfrage pro geänderter Tageszeile.
- Fehlgeschlagene Aktualisierungen zeigen keine vermischten alten und neuen Zahlen. Langsame Antworten dürfen einen inzwischen gewechselten Zeitraum nicht überschreiben.

- In der Pipeline kann eine frühere Buchungsgruppe ausgewählt werden, z. B. August mit Fortschritt bis 8. September. Tag/Woche gruppieren die Herkunft nach Kalenderwochen, Monat und Drei-Monats-Rückblick nach Monaten. Die sechs Übergangsstufen enthalten dieselben Leads, jeden Lead einmal; der Nenner wird nie aus einer anderen Buchungsgruppe übernommen.
- Die eigenständige Herkunftstabelle ist auf Nutzerwunsch aus der Oberfläche entfernt. Die Erstbuchungszuordnung bleibt Grundlage der Buchungsgruppen und Übergangsquoten. Nicht nachgewiesene oder erst später liegende Buchungen erzeugen keine Buchungsquote.
- Quelle und Terminlieferant filtern innerhalb des Pipeline-Abschnitts die Pipeline, Leadqualität und Gesprächsergebnisse gemeinsam. Die Buchungsgruppenauswahl steuert ausdrücklich nur die Pipeline; Gesprächsergebnisse zählen weiterhin das ausgewählte Aktivitätsfenster. Die oberen Gesamtzahlen, der Gesamtverlauf, offene Gesamtbestand und Monatsplanung sind als Gesamtzahlen gekennzeichnet.
- `reconcile_close_sales_snapshot` ersetzt die minimale vollständige Buchungshistorie atomar zusammen mit Custom-Fakten, Won und Quellenzuordnung. Unvollständige, widersprüchliche oder veraltete Snapshots werden vor dem Ersetzen abgewiesen. Der vorhandene 15-Minuten-Cron nutzt diesen Weg automatisch; keine manuelle Leadliste und keine CRM-Schreiboperationen.

## Missing Context

- Der detaillierte Prozessverlauf umfasst das rollierende Drei-Monats-Fenster. Die minimale Erstbuchungshistorie wird aus allen vollständig geladenen Close-Aktivitäten der drei Vertriebsnutzer erhalten und überlebt die Rohdatenbereinigung. Ältere Buchungsdaten können eine Herkunft belegen, aber keinen vollständigen alten Prozessverlauf ersetzen. Die Neukunden-Deduplizierung bezieht sich auf die gespeicherte Won-Historie; dies ist kein lebenslanges Kundenregister.
- Ein verlässlich gepflegtes separates Vertrags-Unterschriftsdatum wurde nicht festgestellt. Maßgeblich bleibt das Won-Datum in Close. Eine falsche Datierung in Close wird nicht aus Freitext korrigiert.
- Der offene Bestand bildet dokumentierte Aktivitäten ab, nicht sämtliche aktiven Opportunity-Phasen oder zukünftigen Kalendereinträge. Ein fehlender oder widersprüchlicher CRM-Eintrag bleibt eine Datenlücke.
- Es gibt keine verlässlich gepflegte Verkaufszyklus-ID. Die Kohorte bezieht sich auf den Lead und seine erste dokumentierte Buchung, nicht auf einen geratenen neuen Verkaufszyklus. Korrekturen oder gelöschte Buchungsaktivitäten können die nachgewiesene Erstbuchung ändern. Leadquellen stammen weiter aus dem aktuellen Close-Feld; eine historische Quelle wird nicht behauptet.

## Sources

- `supabase/migrations/20260908082307_audit_complete_sales_journey.sql`
- `supabase/functions/close-sync/index.ts`
- `supabase/functions/_shared/close-mapping.ts`, `supabase/functions/_shared/weekly-review.ts`
- `supabase/migrations/20260908085704_fix_booking_cohort_filters.sql`
- `cohort-filters.mjs`, `tests/cohort-filters.test.mjs`
- `pipeline-metrics.mjs`, `antony-planner.mjs`, `app.js`, `data.js`
- `tests/verify-sales-journey.mjs`, `tests/report-loading.test.mjs`, `tests/antony-planner.test.mjs`
- `docs/private-access.md`, `docs/sales-goals.md`

## Timeline

- 2026-09-04: Aggregierte offene Pipeline und periodengerechter Gesamtverlauf eingeführt.
- 2026-09-08: Vollprüfung anhand gespeicherter Fakten und ursprünglicher Close-Aktivitäten. Durchgehende Buchungsgruppen, Monatsübergänge, CC2 als optionaler Schritt, vollständigerer offener Bestand und konsistente Aktualisierung ergänzt.

- 2026-09-08, nach der Vollprüfung: Auf Nutzerwunsch Endpunkt auf Neukunde reduziert; CC2 bleibt optional. Gezeigter Leadstatus und datierter Won am geprüften Neukunden stimmen überein. Ein Leadstatus allein ersetzt weiterhin kein verlässlich datiertes Abschlussereignis.

- 2026-09-08: Feste Erstbuchung, vollständiger Buchungshistorien-Snapshot, Monat-/Wochen-Herkunft, frühere auswählbare Buchungsgruppen und konsistente lokale Quellenfilter ergänzt. SQL-Szenarien testen auch wiederholte Buchungen, zukünftige Buchungen, Retention und atomare Korrekturen.

- 2026-09-08: Auf Nutzerwunsch den Abschnitt „Herkunft der Gespräche und Neukunden“ einschließlich seiner Darstellung im Drei-Monats-Rückblick entfernt.
