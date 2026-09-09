# Antony: historische Statuswechsel ab Setting

Stand 09.09.2026. Diese Regel ersetzt die bisherigen Antony-Buchungsgruppen, Herkunftsauswertungen, Terminplanungen, Zielrechner und Prognosen. Michael/Felix behalten ihre bestehenden Opening-Dashboards und Anrufzeiten.

Quelle ist der vom Nutzer vorgegebene Close Status Change Report, Abschnitt Setting bis Verkauft. Die Status-IDs und Bezeichnungen wurden am 09.09. direkt aus Close gelesen. Angezeigt werden Setting, Setter Follow Up, Goldstandard Follow Up, No Show Setting, Closing, CC2 Nachgespräch, Angebotsphase, No Show Closer, Nicht Verkauft Follow-Up und Verkauft Neukunde. Ausgänge in andere Status (z.B. Disqualifiziert) bleiben als belegte Übergänge sichtbar.

- Zeitbezug: `close_funnel_events.occurred_at` aus Close `activity_at`, in Europe/Berlin. Nur aktuelle, nicht zurückgezogene `lead_status_change`-Revisionen; Vorher und Nachher müssen sich unterscheiden.
- Obergrenze ist das Minimum aus tatsächlicher Uhrzeit, letztem vollständig veröffentlichten Funnel-Snapshot und Ende des gewählten Stichtags. Keine Zukunftstermine und keine vorgemerkten Aktivitäten.
- Je Status zählen Erreicht/Verlassen eindeutige Lead-IDs im gewählten Zeitraum. Wiederholungen werden daneben als Wechsel ausgewiesen. Die Timeline zeigt den kumulierten Stand derselben eindeutigen Leads je Status.
- Die Übergangsquote eines Schritts lautet: eindeutige Leads mit dem konkreten Zielstatus / eindeutige Leads, die diesen Schritt im Zeitraum verlassen haben. Der Nenner steht immer direkt dabei. Rückkehrer können in mehreren Zielgruppen enthalten sein; bei Überschneidungen erscheint ein Hinweis. Quoten verschiedener Status werden niemals aus unabhängigen Periodensummen zu einem erfundenen Funnel verbunden.
- Kein Wechsel wird als stattgefundener Setter/Closer Call interpretiert. CC2-Status bedeutet CC2-Status, nicht bestätigte Durchführung. Follow-up ist kein endgültiger Verlust. Verkauft zählt den belegten Eintritt in den gleichnamigen Lead-Status; es gibt keinen Opportunity- oder Kalender-Fallback.
- Keine Begrenzung auf neue Leads oder im aktuellen Monat gebuchte Termine. Wer schon im Vormonat im Setting war und heute wechselt, zählt heute bei diesem Ausgang.
- Ein Klick auf einen Schritt zeigt seine Übergänge; ein Klick auf eine Quote öffnet Zähler/Nenner; „Belege“ filtert exakt diesen Weg mit Datum/Uhrzeit und Close-Link.
- Zugriff über `get_antony_status_report`: bestehende serverseitige Antony-Berechtigung, anonym verweigert. Keine Leadnamen oder Ereignisse in öffentlichen Dateien.

## Automatische Fortschreibung

Die bestehende `close-sync`-Automatisierung lädt bereits alle Lead-Statusänderungen ab dem Beginn des rollenden Dreimonatsfensters, vollständig paginiert, und veröffentlicht sie atomar in `close_funnel_events`. Ältere bereits gespeicherte Ereignisse bleiben erhalten. Es wurde kein Einzelfall ergänzt und keine Buchung zur Durchführung umgedeutet. Der neue Bericht liest bei jeder Aktualisierung diese Quelle. Die belegte Historie beginnt am 01.07.2026; frühere Auswahlen geben einen expliziten Fehler statt falscher Nullen zurück. Änderungen an den freigegebenen Prozessstatus sind in `private.antony_status_definitions` zu pflegen; fremde Zielstatus verschwinden nicht aus den Übergängen.

## Geprüft

- SQL mit getrennten Leads/Wechseln, wiederholtem CC2, Vormonatszugang, Berliner Tagesgrenze, historischen Stichtagen und zukünftigen Ereignissen; Tag/Woche/Monat/Dreimonatszeitraum.
- Keine Übernahme von Kalendern, Buchungsaktivitäten, alten Revisionen oder zurückgezogenen Ereignissen; anonymer und unberechtigter Zugriff verweigert.
- Live-Abgleich September: Setting 12 hinein / 16 hinaus, Setter Follow Up 7 / 3, Goldstandard 1 / 2, No Show Setting 8 / 3, Closing 0 / 3, CC2 4 / 3, Angebot 1 / 2, No Show Closer 2 / 0, Nicht Verkauft Follow-Up 2 / 4, Verkauft Neukunde 1 / 0. Die aufgeklappten Close-Grafiken für Setting, Closing und CC2 stimmen in allen Zielgruppen überein.
- Der Snapshot am 09.09. um 15:22 Uhr Berlin enthielt 47 relevante Statuswechsel im Monat; 5 CC2-Eingänge betrafen 4 Leads. Die Werte werden mit späteren Syncs weitergeführt.
