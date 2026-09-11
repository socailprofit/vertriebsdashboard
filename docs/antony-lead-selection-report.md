# Antony: Close-Leadauswahl und aktueller Status

Die Close-Auswahl bestimmt die Grundgesamtheit. Der aktuell synchronisierte Leadstatus bestimmt die Aufteilung. Eine Statuswechsel-Aktivität ist weder ein geführtes Gespräch noch ein Termin.

| Auswahl | Passender Statuswechsel | Zeitfeld | Filter-Zeitzone |
| --- | --- | --- | --- |
| Setting | Old status = Setting | Date created | UTC, entsprechend der gelieferten Filtervorlage |
| Closing | Old status = Closing | Date created | Europe/Berlin, entsprechend der gelieferten Filtervorlage |
| Neukunden | New status = Verkauft – Neukunde | Date created | UTC |

Tag, Woche, Monat und drei Monate verwenden dieselbe Auswahlregel. Das Ende ist exklusiv und wird auf den vollständigen Importstand begrenzt. Die verlinkten Close-Filter sind Referenzen mit einem festen Zeitraum, keine dynamisch aktualisierten Dashboard-Links.

- Pro Auswahl und Zeitraum zählt jeder Lead einmal, auch bei mehrfachen passenden Wechseln.
- Statusanteil = Leads in diesem aktuellen Status / relevante Leads ohne aktuelle No Shows. Die No-Show-Quote verwendet weiterhin alle Leads der Auswahl. Fehlende Status werden separat gehalten.
- Die Herkunfts-/Verantwortungszeilen verwenden ihre jeweilige relevante Zeilenbasis ohne No Shows für Statusanteile. Fehlende CRM-Felder bleiben enthalten.
- Verschiedene CRM-Benutzer mit identischem Namen bleiben getrennte Gruppen.
- Follow-ups und CC2 bleiben eigene Status. Aus einem No-Show-Status wird keine Teilnahme oder Show-Rate abgeleitet.
- Die drei Auswahlen sind unabhängig. Ihre Zahlen werden weder summiert noch zu einer gemeinsamen Abschlussquote verrechnet. Ein Neukunden-Statuswechsel kann aus einem früheren Closing stammen; er beweist kein neues Vertragsdatum.
- Auch bei einem historischen Auswahlzeitraum zeigt die Aufteilung den aktuellen synchronisierten Status und die aktuellen CRM-Stammdaten, keinen eingefrorenen damaligen Bestand.

Der reguläre `close-sync` importiert Branche, WZ, Mitarbeiterzahl, Leadquelle und Owner/Opener/Setter/Closer. Ausgewählte Leads werden bei jedem Lauf aktualisiert, auch ohne Gesprächsaktivität. Ein persistenter Marker hält ältere Auswahlen aktuell. Die Metadaten werden atomar mit dem vorhandenen Funnel-Snapshot gespeichert. Keine manuell eingetragenen Leadlisten und kein separater Daten-Backfill.

Der RPC `get_antony_lead_selection_report` erzwingt `has_antony_access()`. Die Quelltabelle bleibt privat; Leadprofile werden nicht öffentlich ausgeliefert. Der Browser lädt ausschließlich den neuen RPC für Antony. Michael/Felix behalten ihre bisherigen Kennzahlen und Zeitraumregeln.

Prüfung: `node --test tests/*.test.mjs tests/close-lead-dimensions.test.ts tests/close-read-client.test.ts tests/close-funnel-events.test.ts`; SQL separat mit `node tests/verify-lead-selections.mjs /path/to/@electric-sql/pglite/dist/index.js`. Die SQL-Prüfung deckt Auswahlzeitfeld, beide Zeitzonen, Mehrfachwechsel, aktuelle Status, ausgeschlossene Revisionen, Zukunft, alle Zeiträume und Berechtigungen ab.

Filter für Rolle/Mitarbeiter, Leadquelle, Branche und aktuellen Status werden gemeinsam auf Karten, Raten, Diagramm und Beleglisten angewendet. Sie verwenden aktuelle CRM-Felder. Der Verlaufsgraph rekonstruiert die damaligen Status aus den protokollierten Wechseln (Date created), ohne heutige Status rückzudatieren. Spätere Wechsel aktualisieren erst den entsprechenden Punkt. Teilmengen wie CC2 und Follow-ups sind nicht zu den relevanten Leads zu addieren.

Michael/Felix erhalten im Monatsrückblick drei Monate aus denselben `get_dashboard_metrics`-Regeln wie die Hauptkennzahlen. Der Stichtag bestimmt die drei Monate; Zukunft wird begrenzt. Quotenänderungen sind Prozentpunkte. Δ vergleicht ausschließlich zwei vollständige Monate.

Nach einer unklaren Finalizer-Antwort prüft der Import einmal mit einem eigenen 3-Sekunden-Limit den bereits gespeicherten, unveränderlichen Run samt Manifest. Nur ein bestätigter Commit erlaubt die anschließende Kennzahlenberechnung; ein offener Upload oder externer Abbruch bleibt ein Fehler.

Anrufimporte sind erst ab dem ersten erfolgreichen Importfenster belegt. Der Dreimonats-RPC ermittelt die abgedeckten Kalendertage aus erfolgreichen Importfenstern. Nicht importierte Anrufmonate bleiben unbekannt; Teilbestände werden gekennzeichnet und von Wachstumsvergleichen ausgeschlossen. Der service-interne Finalizer erhält ein begrenztes 40-Sekunden-SQL-Limit, damit ein größerer Snapshot nicht wiederholt kurz vor dem Abschluss zurückgerollt wird.


## Getrennte Setting-Zahlen (11.09.2026)

Die Setting- und CC1-Karten zeigen die CRM-Statuswechsel-Auswahl und deren Teilmenge mit belegtem Gespräch nebeneinander. Zusätzlich steht die Anzahl eindeutiger Leads mit Gespräch innerhalb des gewählten Zeitraums separat darunter. Ein Gespräch vor Monatsbeginn kann zur rückblickenden Statuswechsel-Auswahl gehören, erhöht aber nicht die Monatsaktivität. Die ursprüngliche CRM-Auswahl wird nicht mehr durch die Gesprächsprüfung verdeckt.

Zeitgrenzen gelten einheitlich bis zum Datenstand und maximal bis jetzt. Neu gebuchte, zukünftige Termine begründen weder eine Gesprächszahl noch einen Quotennenner. Ein früherer tatsächlich dokumentierter Versuch bleibt auch bei einer späteren Neubuchung erhalten. Setter-Vorlagen ohne gepflegtes Ergebnis gelten nicht als Gesprächsnachweis. Ungeklärte Teilnahmen und Überschneidungen zwischen Show und No Show bleiben explizit sichtbar; No Show wird nicht als Gegenanteil von Show errechnet.

Die gemeinsame Modellfunktion berechnet Karten, Diagramme, Filter und Detailnachweise nach denselben Regeln bei jedem regulären Datenabruf. Keine Einzelfall- oder Sollwertkorrekturen.
