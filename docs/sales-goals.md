# Current Truth

Michael und Felix haben jeweils 150 Brutto-Anrufe je Montag bis Freitag als Vorgabe. Die am 08.09.2026 geprüften zentralen Ziele sind 19.800 Anrufe für den 01.07.–31.12.2026: 132 Werktage × 150. Feiertage werden nicht abgezogen.

Das sichtbare Tages-, Wochen- oder Monatsziel umfasst den vollständigen gewählten Zeitraum. Beispiel September 2026: 22 Werktage × 150 = 3.300 Anrufe pro Person, 6.600 für beide zusammen. Eine volle Arbeitswoche hat 750 pro Person, 1.500 im Team.

Die Ampel für Brutto-Anrufe vergleicht die tatsächlich erfassten Anrufe mit dem Soll für die Werktage bis zum Stichtag: unter 100 je Tag rot, ab 100 gelb, ab 150 grün. Am 08.09.2026 sind sechs Werktage des Monats vergangen: unter 600 rot, 600–899 gelb, ab 900 grün pro Person. Das volle Monatsziel bleibt dabei 3.300. Die Oberfläche benennt beide Bezugsgrößen und kennzeichnet den Zielbalken als Anteil am vollständigen Zeitraumziel.

Die Berechnung verwendet weiterhin die zentral gespeicherten Zielzeiträume. Wochenenden erzeugen in der Tagesansicht kein künstliches Tagesziel. Fehlende Ziele und fehlende Ist-Werte bleiben neutral. Quotenziele anderer KPIs werden nicht skaliert und ihre bestehenden Ampelgrenzen bleiben erhalten.

# Missing Context

Die derzeit gespeicherten Vorgaben enden am 31.12.2026. Für spätere Zeiträume müssen zentrale Zielvorgaben vorhanden sein; der Browser erfindet oder verlängert keine Zieldaten. Urlaub und Feiertagsregeln sind nicht vereinbart.

# Sources

- Produktive `sales_targets` für Michael und Felix, lesend geprüft am 08.09.2026.
- Nutzerregel: 150 Anrufe pro Wochentag; unter 100 rot, ab 100 gelb, ab 150 grün.
- `sales-goals.mjs`, `tests/sales-goals.test.mjs`, `app.js`.

# Timeline

- 08.09.2026: Fehler eingegrenzt: anteiliges Soll bis Stichtag wurde als Monatsziel dargestellt. Volles Zeitraumziel und Ampel-Soll getrennt; zentrale Zieldaten unverändert.
