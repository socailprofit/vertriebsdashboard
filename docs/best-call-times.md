# Zwei beste Anrufzeitfenster je Person

Michael und Felix erhalten getrennte Empfehlungen für Tag, Woche, Monat und den bestehenden Dreimonatsrückblick. Grundlage ist die in Close erfasste Ereignisstunde in **Europe/Berlin**, nicht die Uhrzeit des gebuchten Termins. Ein Fenster umfasst eine Stunde. Auch Aktivität außerhalb von 08–18 Uhr wird berücksichtigt. Nach jeder normalen Datenaktualisierung wird die Rangfolge neu berechnet; ein manueller Import oder eine neue Automation ist nicht erforderlich.

## Regel

- Je ausgewählter Kennzahl werden maximal zwei unterschiedliche Fenster empfohlen: Gesamtqualität, Erreichbarkeit, Durchstellung, Entscheiderquote oder Terminquote.
- Ein empfohlenes Fenster braucht mindestens **10 Brutto-Anrufe**. Für Gesamtqualität braucht es zusätzlich mindestens **5 produktive Kontakte**. Für Durchstell-, Entscheider- und Terminquote müssen mindestens **5 Fälle in der jeweiligen Bezugsgröße** vorliegen; für Erreichbarkeit sind es 10 Brutto-Anrufe.
- Einzelquoten benötigen mindestens einen beobachteten Erfolg. Gibt es nur ein geeignetes Fenster, bleibt Platz 2 unbesetzt. Bei null geeigneten Fenstern wird keine Empfehlung angezeigt. Die Mindestmengen sind betriebliche Regeln und kein statistischer Signifikanznachweis.
- Die Rangfolge nutzt geglättete Quoten: `(Erfolge + persönliches Zeitraumsmittel × min(5, Periodenbasis)) / (Stundenbasis + min(5, Periodenbasis))`. Angezeigte Quoten und absolute Werte bleiben ungeschönt. Der geglättete Rangwert steht zusätzlich im Detailfenster.
- Gesamtqualität gewichtet produktive Erreichbarkeit mit 35 %, Durchstellung mit 25 %, Entscheider- und Terminquote mit jeweils 20 %. Fehlende, nicht berechenbare Stufen werden nicht aus anderen Stunden erfunden; vorhandene Gewichte werden anteilig verwendet. Das Ergebnis sind Punkte von 0 bis 100, keine Abschlusswahrscheinlichkeit.
- Gleichstand: größere Bezugsgröße, danach mehr Brutto-Anrufe, danach frühere Stunde. Vor der Sortierung wird nicht gerundet.
- Doppelte Stundenzeilen werden aus absoluten Zählern addiert. Stunden- oder Personenprozente werden nicht gemittelt. Widersprüchliche Zähler (z. B. mehr Termine als Entscheiderkontakte) ergeben keine Empfehlung und werden nicht auf 100 % gekappt.

## Unter-KPIs

| Kennzahl | Berechnung |
| --- | --- |
| Nettoquote | Netto-Anrufe / Brutto-Anrufe |
| Produktive Erreichbarkeit | (Netto − Mailbox − außerhalb Geschäftszeit) / Brutto |
| Durchstellquote | Ausdrücklich durchgestellt / bewertbare Vorzimmer-Ergebnisse |
| Entscheiderquote | Erreichte Entscheider / produktive Kontakte |
| Terminquote | Persönlich vereinbarte Termine / erreichte Entscheider |

Das Detailfenster zeigt zusätzlich die Zähler und Bezugsgrößen, direkte Entscheiderkontakte, GF/Entscheider nicht erreicht, Vorzimmer-Ablehnung, E-Mail-Anforderung, kein Interesse, Mailbox und außerhalb der Geschäftszeiten. **GF nicht erreichbar, Mailbox und außerhalb der Geschäftszeiten erweitern die Durchstellbasis nicht.** Die bestehende Kanalregel für LinkedIn-Termine bleibt erhalten.

`get_call_hour_report` ergänzt die vorhandene Stunden-RPC um Diagnosen aus denselben importierten Close-Fakten. Ein Ergebnis „nicht erreicht“ wird nur ohne gleichzeitig erfassten Entscheiderkontakt gezählt. Explizit direkt nicht erreichte Entscheider werden berücksichtigt, ohne aus „GF nicht erreichbar“ automatisch eine direkte Durchwahl abzuleiten. Die neue RPC erfordert einen gültigen Dashboard-Zugang; anonyme Aufrufe sind gesperrt.

Alle Zeiträume enden am gewählten Stichtag (Woche spätestens Freitag), auch der Dreimonatsrückblick. Dieser beginnt am ersten Tag des vorvorigen Monats. Spätere Ereignisse werden bei historischen Stichtagen nicht vorweggenommen.

Quellen: `close_activity_facts`, `close_raw_activities`, bestehendes `get_call_hour_performance`, `call-time-score.mjs`, `call-time-view.mjs`.

## Zugriff und Prüfung

Die neue Aggregat-RPC ist absichtlich eine geschützte `SECURITY DEFINER`-Funktion mit leerem `search_path`, expliziter Dashboard-Prüfung und ohne Ausführungsrecht für `anon`/`PUBLIC`. Rohe CRM-Tabellen werden nicht für Browser freigegeben. Der [Supabase-Hinweis zu ausführbaren Definer-Funktionen](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) ist für diese ausdrücklich autorisierte Aggregat-Schnittstelle erwartet; die Zugriffssperre wird separat getestet.

Automatische Prüfungen: `node --test tests/*.test.mjs` sowie `node tests/verify-call-hour-report.mjs <Pfad zu @electric-sql/pglite/dist/index.js>`. Die SQL-Prüfung vergleicht alle bisherigen Stunden-KPIs mit der ergänzten RPC und prüft vier Zeiträume, historische Stichtage, GF-Diagnosen, LinkedIn-Ausschluss und Zugriffsrechte. Reale Monats- und Zeitraumsergebnisse werden ausschließlich lokal geprüft und nicht als Testdaten veröffentlicht.
