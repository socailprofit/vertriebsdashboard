# Social Profit Vertriebsdashboard

## Current Truth

- Eine gemeinsame interne Webapp mit Team-, Michael-, Felix- und Chefansicht.
- Michael und Felix sehen ihre Einzelwerte und den gemeinsamen Wettbewerb.
- Antony sieht zusätzlich Ziele, Sync-Status und später die tägliche KI-Zusammenfassung.
- Close bleibt die einzige Quelle für Calls, Aktivitäten, Termine, Abschlüsse und Umsatz.
- Das verbindliche Close-Mapping liegt versioniert unter `docs/close-mapping.md` und im serverseitigen Mapping-Modul.
- Supabase speichert Benutzerrollen, Ziele, Rohaktivitäten, Tageskennzahlen und Sync-Protokolle.
- Der schreibfreie End-to-End-Sync-Test und ein manuell freigegebener Ein-Tages-Schreibimport für 2026-09-01 sind am 2026-09-02 erfolgreich gelaufen; der Abgleich der Zahlen gegen Close steht noch aus.
- KPIs und Quoten werden deterministisch berechnet; KI formuliert später nur die Zusammenfassung.
- Der erste sichtbare KPI-Umfang ist auf Brutto-/Netto-Calls, beste Anrufzeiten, Vorzimmer, Durchstellungen, direkte und gesamte Entscheiderkontakte, Termine, Terminquote und Newsletter begrenzt.
- Michael wird blau und Felix orange dargestellt; Leistungsfarben richten sich später nach den von Antony gesetzten Zielen.
- Tag, ISO-Woche von Montag bis Sonntag und Kalendermonat werden in der Zeitzone Europe/Berlin abgegrenzt.
- Die Trendansicht zeigt den aktuellen Monat und die zwei Vormonate mit den wichtigsten KPIs.
- Es gilt ein rollierendes Drei-Monats-Fenster: aktueller Monat plus zwei Vormonate.
- Beim Monatswechsel werden Rohaktivitäten, Tageswerte, Zusammenfassungen, Ziele und Sync-Protokolle vor diesem Fenster gelöscht.
- Das lokale Supabase-Fundament ist vorbereitet, aber noch nicht produktiv ausgerollt.

### Lokale Vorschau

Im Projektordner einen statischen Webserver starten:

```bash
python3 -m http.server 4173
```

Danach `http://127.0.0.1:4173/` öffnen.

### Sicherheitsregeln

- Keine Close-, Supabase-Service- oder OpenAI-Schlüssel im Repository oder Frontend.
- Produktive Schlüssel werden ausschließlich als serverseitige Supabase-Secrets gespeichert.
- Rohdaten und Sync-Schreibzugriffe sind nicht für normale Dashboard-Benutzer freigegeben.
- Ziele dürfen nur Benutzer mit Manager-Rolle ändern.
- Die stündliche Automation und die tägliche Datenbereinigung bleiben deaktiviert, bis ein manueller Testtag geprüft wurde.

## Missing Context

- Quelle und Definition der Newsletter-Zahl.
- Entscheidung für künftige `monthly`- oder `annual`-Opportunity-Werte: Vertragswert, MRR oder ARR.
- Login-Verfahren und Zuordnung der drei Supabase-Benutzerkonten.
- Welche vier bis sechs dieser festgelegten KPIs in der besonders kompakten Drei-Monats-Trendansicht erscheinen sollen.

## Sources

- Close CRM Organisation und vorhandene Benutzer-/Aktivitätsfelder, read-only analysiert.
- Verbindliches Mapping: `docs/close-mapping.md`, Version `2026-09-02.v1`.
- Supabase-Projekt `socailprofit's vertriebsdashboard`.
- GitHub-Repository `socailprofit/vertriebsdashboard`, Branch `main`.
- Referenz: bereitgestellter Plecto-Screenshot und KPI-Notizen.

## Timeline

- 2026-09-02: GitHub CLI installiert und lokales Projekt mit GitHub verbunden.
- 2026-09-02: Supabase-Datenmodell, Rollen, RLS-Regeln und sichere Sync-Hülle lokal angelegt.
- 2026-09-02: Exakte Tag-/Woche-/Monatsabfragen sowie Drei-Monats-Trend im Datenmodell ergänzt.
- 2026-09-02: Geschützte Bereinigungsfunktion für das rollierende Drei-Monats-Fenster ergänzt.
- 2026-09-02: Close-Mapping anhand aktiver Felder und realer Beispiele verbindlich festgelegt.
- 2026-09-02: Sichtbaren KPI-Umfang anhand der Nutzerreferenz auf den ersten MVP begrenzt.
- 2026-09-02: Manuellen Close-Sync mit schreibfreiem Standardmodus, Pagination, Tagesaggregation und stündlicher Anrufzeiten-Auswertung lokal fertiggestellt.
- 2026-09-02: Fünf lokale Mapping-Tests für Brutto/Netto, Vorzimmer, Entscheider, Termin und Deal-Zuordnung bestanden.
- Nächster Schritt: separaten Close-API-Key sicher in Supabase hinterlegen und einen schreibfreien Testtag ausführen.
- Danach: Ergebnisse gegen Close prüfen, erst dann Daten schreiben, stündlichen Cron aktivieren und Frontend anbinden.
