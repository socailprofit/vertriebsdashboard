# Antony: verbindliche Reportingregeln

Close ist die Quelle. Supabase berechnet Zuordnung, Belege, Grundgesamtheiten und Stufenstatus. Das Frontend filtert und visualisiert den autorisierten Report. Keine historischen Nachimporte und keine handgepflegten Ergebniszuordnungen.

## Monat und Prognose

- Erster gültiger Setter-Kalendertermin je Vorgang, Europe/Berlin, bestimmt den Kohortenmonat. Ein vor Durchführung nach Oktober verschobener September-Ersttermin gehört zu Oktober. Ersatztermine erzeugen keinen weiteren Vorgang.
- Ein Folgetermin eines bereits begonnenen Vorgangs verschiebt dessen Kohorte nicht. Seine tatsächliche Aktivität zählt trotzdem im Monat der Durchführung.
- Fällige Ersttermine sind Ist-Basis; noch anstehende Ersttermine desselben Monats sind Planung. Zukünftige Termine erzeugen weder Teilnahme noch No-Show.
- Die Monatsprognose verwendet ausschließlich Ersttermine dieser Monatskohorte einschließlich konkret anstehender Ersttermine und die belegten Übergangsquoten derselben Kohorte. Keine Arbeitstagshochrechnung und keine Closer Calls anderer Kohorten. Bei fehlenden Nennern bleibt das entsprechende Ergebnis unbekannt.
- Eigene Raten wirken nur in der ausdrücklich gewählten Simulation. Sie verändern keine Ist-Rate und keine Monatsprognose. Modellumsatz ist mögliche Neukunden × eingegebener Kundenwert, kein gebuchter Umsatz.

## Aktivität, Quelle und Person

- Haupt-KPIs zählen tatsächliche Periodenaktivität unabhängig vom Kohortenmonat: fällige Setter-Termine, Setter Calls, Closer Calls inklusive CC2, durchgeführte CC2, erstmalige Neukundenabschlüsse.
- Ein Lead wird nur bei seiner ersten belegten Akquisition Neukunde. Belegte Abschlüsse bleiben auch ohne lückenlose Zwischenstufen sichtbar; daraus wird keine verknüpfte Übergangsquote erfunden.
- Gesprächsleistung gehört zum Akteur der Close-Aktivität. Herkunft bezeichnet den Opener bzw. den bestehenden LinkedIn-Kanal. Der Quellenfilter nutzt `1.02 Leadquelle` (`cf_2CMz3g4iGjEjeWmrbouveHjdBsMHaLttdpV4vrgVurd`), mit fünf Gruppen: DMC (DMC und Cold Calling/Cold Calls), LinkedIn (einschließlich Ads, Cold Calls und Follow Up), North Data (auch Northdata), Messe und Website. Rohwerte in Close und Supabase bleiben erhalten. Andere Quellen bleiben in „Alle Quellen“ enthalten und werden keiner der fünf Gruppen zugeschlagen.
- Quellenfilter wirken gleichzeitig auf Vorgangsdetails, Kalenderdetails, Übergangsquoten und Showrate. Sie verändern nicht die Haupt-KPIs oder die Monatsprognose.

## Pipeline und Details

- Fünf sichtbare Stufen: Setter-Termin, Setter durchgeführt, Closer 1, CC2 optional, Neukunde. Closer 1 vereinigt qualifizierte und unabhängig belegte Closer-Vorgänge; die Detailfilter trennen Terminierung, Durchführung und Ergebnis.
- Supabase liefert die Stufenzugehörigkeit und Statuswerte in `month_pipeline_rows[].stages`. Das Frontend darf aus fehlenden Feldern keinen Status ergänzen. Die Pipeline zeigt diese Werte in kompakten Minifenstern ohne Namen oder Leadlinks.
- CC1-Ergebnisse enden bei der ersten belegten CC2-Vereinbarung; spätere Ergebnisse gehören zu CC2. Eine CC2-Vereinbarung allein ist keine CC2-Durchführung. Eine belegte CC2-Durchführung bleibt auch bei einer späteren Absage sichtbar; aktueller Status und historische Durchführung werden unabhängig ermittelt. Ein expliziter Verkauf in CC2 bleibt ohne vorherige Vereinbarung als CC2 sichtbar, mit markierter fehlender Vereinbarung; er beweist keinen CC1-Call.
- Abgesagt, verschoben, nicht erschienen, abgelehnt und verkauft benötigen explizite Belege. Fehlende oder widersprüchliche Ergebnisse bleiben offen. Eine Qualifikation ohne belegtes Gespräch bleibt noch anstehend; ein fehlender konkreter Kalendertermin wird benannt.
- „Durchgeführt“ bezeichnet belegte Durchführung und kann sich mit einem späteren Ergebnisfilter überschneiden. Die Statuszahlen sind deshalb nicht pauschal zu addieren.
- Die kleine Setter-Showrate zeigt erschienene / fällige Setter-Termine einschließlich offener fälliger Ergebnisse im Nenner. Zukunft und Ersatz-Doppelzählungen sind ausgeschlossen. Keine Grundgesamtheit ergibt einen Strich, nicht 0 %.
- Closer-Kalenderergebnisse erfordern eindeutige Belege desselben Vorgangs. Mehrdeutige/überlappende Kalenderfenster werden nicht geraten; keine Closer-Showrate aus einer unvollständigen Terminmenge. `quality_by_origin` liefert dafür Setter-Teilnahmen, fällige Setter-Termine, Closer-/CC2-Teilnahmen, fällige Closer-/CC2-Termine und ungeklärte fällige Kalenderstufen je Quelle und Opener. Bei ungeklärten Stufen bleibt die Closer-Gesamtrate offen. Die Neukundenquote ist erste Neukunden / Vorgänge derselben Ersttermin-Gruppe. Die Reihenfolge in der Herkunftstabelle ist Setter-Showrate, Closer-Showrate, Neukundenquote.

## Betrieb und Schutz

Bestehender regelmäßiger Close-Sync, atomare Snapshot-Verarbeitung und Rollenprüfung bleiben erhalten. Leadnamen werden beim regulären Metadaten-Sync aktualisiert. Private Einzelvorgänge werden nicht in den KI-Kontext übernommen. Die KI erhält nur autorisierte aggregierte Werte und dieselben Kohortenregeln.

Regressionen: Planner-/Status-/Quellenfilter-Tests, lokale SQL-Reporting-Szenarien sowie Normalisierung → Prozessableitung → atomare RPC → Kalender-Integration. Der Monatswechsel wird ohne Reimport geprüft.
