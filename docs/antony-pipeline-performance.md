# Antony-Pipeline und Gesamtverlauf

## Current Truth

- `get_antony_report(period, reference_date)` liefert Aktivitäten, Buchungsgruppe, Zeitverlauf, offenen Bestand, Monatsplanung und Drei-Monats-Rückblick in einem geschützten Datenbanksnapshot. Er verlangt `has_antony_access()`. Die zwei freigegebenen Leitungskonten behalten ihren Zugriff; andere Dashboardkonten erhalten keine Antony-Daten.
- Oben stehen Aktivitäten im ausgewählten Zeitraum. Wiederholte Gespräche sind einzelne Aktivitäten; Neukunden werden pro Lead einmal am ersten gespeicherten Neukunden-Won gezählt. Upsells und Verlängerungen sind ausgeschlossen. Ein späteres Verkaufsgespräch verschiebt diesen Won nicht in einen neuen Monat.
- Die Pipeline verfolgt dieselben gebuchten Leads in zeitlicher Reihenfolge: **Termin → Setter durchgeführt → Closer terminiert → Closer durchgeführt → CC2 vereinbart (optional) → Neukunde**. Die erste Buchung je Lead innerhalb des Zeitraums bestimmt Terminlieferant und Startdatum. Mehrere Gespräche desselben Leads vervielfachen diese Gruppe nicht.
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
- Fehlgeschlagene Aktualisierungen zeigen keine vermischten alten und neuen Zahlen. Langsame Antworten dürfen einen inzwischen gewechselten Zeitraum nicht überschreiben.

## Missing Context

- Der detaillierte Verlauf umfasst das rollierende Drei-Monats-Fenster. Frühere nicht gespeicherte Buchungen können nicht rekonstruiert werden. Die Neukunden-Deduplizierung bezieht sich auf die gespeicherte Won-Historie; dies ist kein lebenslanges Kundenregister.
- Ein verlässlich gepflegtes separates Vertrags-Unterschriftsdatum wurde nicht festgestellt. Maßgeblich bleibt das Won-Datum in Close. Eine falsche Datierung in Close wird nicht aus Freitext korrigiert.
- Der offene Bestand bildet dokumentierte Aktivitäten ab, nicht sämtliche aktiven Opportunity-Phasen oder zukünftigen Kalendereinträge. Ein fehlender oder widersprüchlicher CRM-Eintrag bleibt eine Datenlücke.
- Ein Lead kann bei einer erneuten Buchung in einem späteren Zeitraum wieder in dessen Buchungsgruppe erscheinen. Summen einzelner Monatsgruppen sind deshalb nicht mit der deduplizierten Drei-Monats-Gruppe gleichzusetzen.

## Sources

- `supabase/migrations/20260908082307_audit_complete_sales_journey.sql`
- `supabase/functions/close-sync/index.ts`
- `supabase/functions/_shared/close-mapping.ts`, `supabase/functions/_shared/weekly-review.ts`
- `pipeline-metrics.mjs`, `antony-planner.mjs`, `app.js`, `data.js`
- `tests/verify-sales-journey.mjs`, `tests/report-loading.test.mjs`, `tests/antony-planner.test.mjs`
- `docs/private-access.md`, `docs/sales-goals.md`

## Timeline

- 2026-09-04: Aggregierte offene Pipeline und periodengerechter Gesamtverlauf eingeführt.
- 2026-09-08: Vollprüfung anhand gespeicherter Fakten und ursprünglicher Close-Aktivitäten. Durchgehende Buchungsgruppen, Monatsübergänge, CC2 als optionaler Schritt, vollständigerer offener Bestand und konsistente Aktualisierung ergänzt.

- 2026-09-08, nach der Vollprüfung: Auf Nutzerwunsch Endpunkt auf Neukunde reduziert; CC2 bleibt optional. Gezeigter Leadstatus und datierter Won am geprüften Neukunden stimmen überein. Ein Leadstatus allein ersetzt weiterhin kein verlässlich datiertes Abschlussereignis.
