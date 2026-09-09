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
- Live-Abgleich aller Status und Übergänge mit dem Close-Bericht; öffentliche Dokumentation enthält keine produktiven KPI-Snapshots.

## Teilnahme und Quoten (Ergänzung)

- Die großen Statuszahlen nennen ausdrücklich hinein- und hinausgewechselte Leads im Zeitraum. Sie sind kein aktueller Bestand. Der detaillierte Statusbericht ist eingeklappt.
- Hervorgehobene Weitergaben: Setting in Closing/CC2/Angebot/Verkauft (Zielgruppe je Lead dedupliziert), Closing nach CC2, CC2 nach Verkauft, Angebot nach Verkauft. Alle direkten anderen Wege einschließlich Follow-ups, No-Show, Disqualifizierung und übersprungener Schritte behalten ihre Einzelquote im Übergangsbericht. Nenner sind jeweils die eindeutigen ausgehenden Leads; nicht die Eingänge einer anderen Zeitgruppe.
- Show-Rate = veröffentlichte Aktivitäten mit ausdrücklich dokumentierter Teilnahme / (Teilnahme + ausdrücklich Nicht erschienen). Setter-/Closer-Calls zählen nur mit einem bekannten Ergebnis aus ihrem Ergebnisfeld. Fehlende/unbekannte Ergebnisse, Absagen und Verschiebungen zählen nicht im Nenner und werden separat ausgewiesen.
- Zähleinheit der Teilnahme ist die Close-Aktivitäts-ID je Stufe, nicht Lead oder Kalendereintrag. Mehrere dokumentierte Gespräche eines Leads zählen einzeln. Statuswechsel allein erzeugen weder Show noch No-Show; eine Wiederaufnahme eines Status kann keine Teilnahme erfinden. Die Quote bezieht sich auf dokumentierte Teilnahme-Ergebnisse, nicht auf alle gebuchten oder fälligen Termine. Unvollständige CRM-Dokumentation bleibt eine Einschränkung.
- Die Ergebnisfelder sind: Setter `cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo`, Closer `cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn`, Setter No-Show `cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz`, Closer No-Show `cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q`. Definitionen wurden direkt in Close geprüft.
- Closer-Teilnahme umfasst CC1 und CC2 gemeinsam: Das No-Show-Feld unterscheidet diese Stufen nicht. Keine geschätzte separate CC2-Show-Rate.
- Beide Quellen verwenden identische vergangene Zeitgrenzen und denselben erfolgreichen Sync-Snapshot. Nur aktuelle, nicht zurückgezogene Revisionen. Die bestehende Synchronisierung liefert beide Quellen automatisch; keine manuell nachgetragenen Lead-Einzelfälle. Zugriffsschutz bleibt unverändert.
