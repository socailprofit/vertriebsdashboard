# Zwei beste Anrufzeitfenster je Person

Michael und Felix erhalten getrennte Empfehlungen für Tag, Woche, Monat und den bestehenden Dreimonatsrückblick. Telefonanrufe werden nach ihrem tatsächlichen Close-Anrufbeginn in **Europe/Berlin** zugeordnet. Gesprächsergebnisse verwenden separat die Ereigniszeit der Opening-/Follow-up-Dokumentation; diese ist ohne explizite Verknüpfung kein Beleg für die Anrufstunde. Die Uhrzeit eines gebuchten zukünftigen Termins wird nicht verwendet. Ein Fenster umfasst eine Stunde. Auch Aktivität außerhalb von 08–18 Uhr wird berücksichtigt. Nach jeder normalen Datenaktualisierung wird die Rangfolge neu berechnet; ein manueller Import oder eine neue Automation ist nicht erforderlich.

## Regel

- Je ausgewählter Kennzahl werden maximal zwei unterschiedliche Fenster empfohlen: Gesamtqualität, Erreichbarkeit, Durchstellung, Entscheiderquote oder Terminquote.
- Ein empfohlenes Fenster braucht mindestens **10 Brutto-Anrufe**. Für Gesamtqualität braucht jede der drei dokumentierten Gesprächsstufen mindestens **5 Fälle im Nenner**; alle vier Teilquoten müssen berechenbar sein. Für Durchstell-, Entscheider- und Terminquote müssen mindestens **5 Fälle in der jeweiligen Bezugsgröße** vorliegen; für Erreichbarkeit sind es 10 Brutto-Anrufe.
- Einzelquoten benötigen mindestens einen beobachteten Erfolg. Gibt es nur ein geeignetes Fenster, bleibt Platz 2 unbesetzt. Bei null geeigneten Fenstern wird keine Empfehlung angezeigt. Die Mindestmengen sind betriebliche Regeln und kein statistischer Signifikanznachweis.
- Die Rangfolge nutzt geglättete Quoten: `(Erfolge + persönliches Zeitraumsmittel × min(5, Periodenbasis)) / (Stundenbasis + min(5, Periodenbasis))`. Angezeigte Quoten und absolute Werte bleiben ungeschönt. Der geglättete Rangwert steht zusätzlich im Detailfenster.
- Gesamtqualität gewichtet produktive Erreichbarkeit mit 35 %, Durchstellung mit 25 %, Entscheider- und Terminquote mit jeweils 20 %. Fehlt eine berechenbare Stufe, bleibt der Gesamtscore leer. Gewichte werden niemals auf die übrigen Stufen umverteilt; eine Stunde ohne dokumentierte Entscheider kann deshalb nicht allein über Erreichbarkeit zur besten Gesamtzeit werden. Das Ergebnis sind Punkte von 0 bis 100, keine Abschlusswahrscheinlichkeit.
- Gleichstand: größere Bezugsgröße, danach mehr Brutto-Anrufe, danach frühere Stunde. Vor der Sortierung wird nicht gerundet.
- Doppelte Stundenzeilen werden aus absoluten Zählern addiert. Stunden- oder Personenprozente werden nicht gemittelt. Widersprüchliche Zähler (z. B. mehr Termine als Entscheiderkontakte) ergeben keine Empfehlung und werden nicht auf 100 % gekappt.

## Unter-KPIs

| Kennzahl | Berechnung |
| --- | --- |
| Nettoquote | Netto-Anrufe / Brutto-Anrufe |
| Produktive Erreichbarkeit | Netto-Anrufe ohne die beiden dokumentierten Ausschluss-Outcomes / Brutto; jeder Anruf wird einzeln geprüft |
| Durchstellquote | Ausdrücklich durchgestellt / bewertbare Vorzimmer-Ergebnisse |
| Entscheiderquote | Erreichte Entscheider / dokumentierte Opening- und Follow-up-Aktivitäten derselben Stunde |
| Terminquote | Persönlich vereinbarte Termine / erreichte Entscheider |

Das Detailfenster zeigt zusätzlich die Zähler und Bezugsgrößen, direkte Entscheiderkontakte, GF/Entscheider nicht erreicht, Vorzimmer-Ablehnung, E-Mail-Anforderung, kein Interesse, Mailbox und außerhalb der Geschäftszeiten. **GF nicht erreichbar, Mailbox und außerhalb der Geschäftszeiten erweitern die Durchstellbasis nicht.** Die bestehende Kanalregel für LinkedIn-Termine bleibt erhalten.

`get_call_hour_report` ergänzt die vorhandene Stunden-RPC um Diagnosen aus denselben importierten Close-Fakten. Ein Ergebnis „nicht erreicht“ wird nur ohne gleichzeitig erfassten Entscheiderkontakt gezählt. Explizit direkt nicht erreichte Entscheider werden berücksichtigt, ohne aus „GF nicht erreichbar“ automatisch eine direkte Durchwahl abzuleiten. Die neue RPC erfordert einen gültigen Dashboard-Zugang; anonyme Aufrufe sind gesperrt.

Alle Zeiträume enden am gewählten Stichtag (Woche spätestens Freitag), auch der Dreimonatsrückblick. Dieser beginnt am ersten Tag des vorvorigen Monats. Spätere Ereignisse werden bei historischen Stichtagen nicht vorweggenommen.

Quellen: `close_activity_facts`, `close_raw_activities`, bestehendes `get_call_hour_performance`, `call-time-score.mjs`, `call-time-view.mjs`.

## Zugriff und Prüfung

Die neue Aggregat-RPC ist absichtlich eine geschützte `SECURITY DEFINER`-Funktion mit leerem `search_path`, expliziter Dashboard-Prüfung und ohne Ausführungsrecht für `anon`/`PUBLIC`. Rohe CRM-Tabellen werden nicht für Browser freigegeben. Der [Supabase-Hinweis zu ausführbaren Definer-Funktionen](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) ist für diese ausdrücklich autorisierte Aggregat-Schnittstelle erwartet; die Zugriffssperre wird separat getestet.

Automatische Prüfungen: `node --test tests/*.test.mjs` sowie `node tests/verify-call-hour-report.mjs <Pfad zu @electric-sql/pglite/dist/index.js>`. Die SQL-Prüfung vergleicht alle bisherigen Stunden-KPIs mit der ergänzten RPC und prüft vier Zeiträume, historische Stichtage, GF-Diagnosen, LinkedIn-Ausschluss und Zugriffsrechte. Reale Monats- und Zeitraumsergebnisse werden ausschließlich lokal geprüft und nicht als Testdaten veröffentlicht.

## Korrektur und Live-Abgleich am 18.09.2026

- Graph und Stundenmatrix verwenden dieselbe Achse vom ersten bis zum letzten Stundenfenster mit erfasster Aktivität, einschließlich früher/später Anrufe und leerer Zwischenstunden. Die feste Begrenzung 08–18 Uhr entfällt. Künftige leere Stunden werden nicht als Ergebnisse gezeichnet.
- `opening_activities` wird in der geschützten Stunden-RPC aus denselben importierten Opening-/Follow-up-Dokumentationen gezählt wie die Entscheiderkontakte. Telefonanrufe dienen nicht mehr als fremder Nenner dieser Quote.
- Produktive Anrufe werden je Anruf ausgewertet. Ein Ausschluss-Outcome an einem ohnehin nicht erreichten Anruf darf nicht ein zweites Mal von Netto abgezogen werden.
- Live-Prüfung: 1.395 Anrufe und 649 Custom-Aktivitäten seit Monatsbeginn ohne Abweichung zwischen importiertem Ereigniszeitpunkt und Berliner Stunden-/Tageszuordnung. Zwei Anrufbeispiele zusätzlich direkt in Close geprüft.
- Nach der Migration: je 48 Stundenzeilen für Tag, Woche, Monat und Drei-Monats-Zeitraum; keine Änderung an Brutto, Netto, produktiven Anrufen, Entscheider- oder Terminanzahlen im direkten Vorher/Nachher-Abgleich. Neue Bezugsgröße in allen Zeilen vorhanden.
- Die sichtbare Synchronisationsuhr verwendet nun den tatsächlichen Fünf-Minuten-Takt von 07:30 bis 17:00, Mo–Fr, Europe/Berlin. Nacht-/Wochenendpausen und Sommer-/Winterzeit sind getestet. Der Import selbst bleibt unverändert.
