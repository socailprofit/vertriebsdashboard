# Antony: Close-Leadauswahl und aktueller Status

Die Close-Auswahl bestimmt die Grundgesamtheit. Der aktuell synchronisierte Leadstatus bestimmt die Aufteilung. Eine Statuswechsel-Aktivität ist weder ein geführtes Gespräch noch ein Termin.

| Auswahl | Passender Statuswechsel | Zeitfeld | Filter-Zeitzone |
| --- | --- | --- | --- |
| Setting | Old status = Setting | Date created | UTC, entsprechend der gelieferten Filtervorlage |
| Closing | Old status = Closing | Date created | Europe/Berlin, entsprechend der gelieferten Filtervorlage |
| Neukunden | New status = Verkauft – Neukunde | Date created | UTC |

Tag, Woche, Monat und drei Monate verwenden dieselbe Auswahlregel. Das Ende ist exklusiv und wird auf den vollständigen Importstand begrenzt. Die verlinkten Close-Filter sind Referenzen mit einem festen Zeitraum, keine dynamisch aktualisierten Dashboard-Links.

- Pro Auswahl und Zeitraum zählt jeder Lead einmal, auch bei mehrfachen passenden Wechseln.
- Statusanteil = Leads in diesem aktuellen Status / alle Leads dieser Auswahl.
- Die Herkunfts-/Verantwortungszeilen verwenden ihre jeweilige Zeilenbasis für Statusanteile. Fehlende CRM-Felder bleiben enthalten.
- Verschiedene CRM-Benutzer mit identischem Namen bleiben getrennte Gruppen.
- Follow-ups und CC2 bleiben eigene Status. Aus einem No-Show-Status wird keine Teilnahme oder Show-Rate abgeleitet.
- Die drei Auswahlen sind unabhängig. Ihre Zahlen werden weder summiert noch zu einer gemeinsamen Abschlussquote verrechnet. Ein Neukunden-Statuswechsel kann aus einem früheren Closing stammen; er beweist kein neues Vertragsdatum.
- Auch bei einem historischen Auswahlzeitraum zeigt die Aufteilung den aktuellen synchronisierten Status und die aktuellen CRM-Stammdaten, keinen eingefrorenen damaligen Bestand.

Der reguläre `close-sync` importiert Branche, WZ, Mitarbeiterzahl, Leadquelle und Owner/Opener/Setter/Closer. Ausgewählte Leads werden bei jedem Lauf aktualisiert, auch ohne Gesprächsaktivität. Ein persistenter Marker hält ältere Auswahlen aktuell. Die Metadaten werden atomar mit dem vorhandenen Funnel-Snapshot gespeichert. Keine manuell eingetragenen Leadlisten und kein separater Daten-Backfill.

Der RPC `get_antony_lead_selection_report` erzwingt `has_antony_access()`. Die Quelltabelle bleibt privat; Leadprofile werden nicht öffentlich ausgeliefert. Der Browser lädt ausschließlich den neuen RPC für Antony. Michael/Felix behalten ihre bisherigen Kennzahlen und Zeitraumregeln.

Prüfung: `node --test tests/*.test.mjs tests/close-lead-dimensions.test.ts tests/close-read-client.test.ts tests/close-funnel-events.test.ts`; SQL separat mit `node tests/verify-lead-selections.mjs /path/to/@electric-sql/pglite/dist/index.js`. Die SQL-Prüfung deckt Auswahlzeitfeld, beide Zeitzonen, Mehrfachwechsel, aktuelle Status, ausgeschlossene Revisionen, Zukunft, alle Zeiträume und Berechtigungen ab.
