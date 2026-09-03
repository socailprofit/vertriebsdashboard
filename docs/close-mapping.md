# Close Mapping für das Vertriebsdashboard

## Current Truth

### Personen und Attribution

| Dashboard | Close-Benutzer | ID |
|---|---|---|
| Michael | Michael Giesbrecht | `user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy` |
| Felix | Felix Wenk | `user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4` |
| Chef | Antony Rigone | `user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR` |

- Call- und Custom-Activity-KPIs werden über `user_id` der Aktivität zugeordnet.
- Gewonnene Deals und Umsatz werden für den Wettbewerb über das Lead-Feld `3.01 Opener` zugeordnet.
- `3.02 Setter` und `3.03 Closer` werden zusätzlich gespeichert, aber ändern die Wettbewerbszuordnung nicht.
- Die Opportunity-Zuordnung über `assigned_to` wird nicht verwendet, weil aktuelle gewonnene Opportunities Antony zugewiesen sind.

### Call-KPIs

| KPI | Close-Quelle | Regel |
|---|---|---|
| Anrufe brutto | Call Activity | `direction = outbound` und finaler Status `completed`, `no-answer`, `busy`, `failed` oder `timeout` |
| Anrufe netto | Call Activity | Brutto-Call mit `status = completed` und `disposition = answered` |
| Gesprächszeit | Call Activity | Summe `duration` nur für Netto-Calls |
| Beste Anrufzeiten | Call Activity und Opening/Follow-up | Zwei Quoten je Stunde in `Europe/Berlin`: Nettoquote (netto/brutto) und Durchstellquote (Durchstellungen/Vorzimmer-Kontakte) |

### Zeit- und Zeitraumlogik

- Der Tag einer Aktivität und ihre Stunde stammen aus Close `activity_at`, vor dem Speichern nach `Europe/Berlin` umgerechnet. Die Uhrzeit des stündlichen Syncs verändert keine Kennzahl.
- **Tag** zeigt exakt den ausgewählten Kalendertag. Der Tagesverlauf listet jede operative Stunde von **08:00 bis 17:00** – auch dann, wenn keine Aktivität vorliegt.
- **Woche** zeigt Montag bis Freitag der Kalenderwoche; Samstag und Sonntag gehören nicht in die Vertriebswoche.
- **Monat** beginnt immer am Ersten und endet am letzten Kalendertag des ausgewählten Monats. Die Trendtabelle zeigt den aktuellen sowie die zwei vorherigen Monate.
- Nettoquote = Summe Netto-Anrufe / Summe Brutto-Anrufe. Durchstellquote = Summe Durchstellungen / Summe Vorzimmer-Kontakte. Terminquote = Summe Termine / Summe Entscheiderkontakte. Das Dashboard bildet nie Mittelwerte aus Einzelquoten.
- Stunden ohne Grundgesamtheit zeigen bei Quoten einen Strich statt `0 %`. Stunden mit weniger als drei Kontakten bleiben sichtbar, werden aber als zu kleine Basis gedämpft und nicht als Empfehlung behandelt.

`created`, `in-progress` und `cancel` zählen nicht als abgeschlossener Versuch. Durch die stündliche Überlappung werden zwischenzeitlich laufende Calls beim nächsten Sync erneut geprüft.

### KPI-Umfang des ersten Dashboards

Im ersten produktiven Stand werden nur folgende Werte sichtbar gemacht:

1. Anrufe brutto
2. Anrufe netto
3. Nettoquote **und** Durchstellquote nach Stunde zur Ermittlung der besten Anrufzeiten
4. Vorzimmer-Kontakte
5. Durchstellungen und Durchstellquote
6. Entscheiderkontakte, zusätzlich getrennt nach direkt erreicht und durchgestellt
7. Termine und Terminquote
8. Newsletter-Abschlüsse

Am 2026-09-02 festgelegt: Beide Stundenquoten werden gezeigt, weil sie verschiedene Fragen beantworten — die Nettoquote sagt, wann überhaupt abgenommen wird, die Durchstellquote, wann man am Vorzimmer vorbeikommt.

Deals und Umsatz werden weiterhin importiert und in Supabase vorgehalten, aber **nicht angezeigt**. Die offene Frage nach Vertragswert, MRR oder ARR bei `monthly`/`annual` bleibt damit vertagt, bis der Umsatz sichtbar werden soll.

### Newsletter-Abschlüsse

- Quelle ist ausschließlich der Close-Workflow `Newsletter` (`seq_1CghCZOXaNSlwDSOIpljTy`).
- Ein Abschluss zählt nur, wenn der Status im Close-Report `goal` (Ziel erreicht, etwa eine Antwort) oder `finished` (Workflow vollständig durchlaufen) ist.
- Der KPI-Tag ist `date_updated`, also der Zeitpunkt des Abschluss-Statuswechsels, in `Europe/Berlin`.
- Die Zuordnung erfolgt über `created_by_id`: Wer den Kontakt in den Newsletter-Workflow aufgenommen hat, erhält den Abschluss.
- Einträge von Antony oder anderen Personen bleiben für den technischen Abgleich gespeichert, zählen aber nicht zu Michael oder Felix, solange keine entsprechende `sales_people`-Zuordnung existiert.

Leistungsfarben stützen sich auf `sales_targets`. Die Tabelle wurde um `calls_gross`, `gatekeeper_contacts`, `transfer_rate_target` und `appointment_rate_target` erweitert, damit jede sichtbare Zahl ein eigenes Ziel bekommen kann. Die beiden Quotenziele sind nullable: kein Ziel ist etwas anderes als ein Ziel von null Prozent. Ohne gesetztes Ziel bleibt eine Zahl neutral eingefärbt statt rot.

Michael wird blau (`#4f8cff`) und Felix orange (`#f59e0b`) dargestellt. Leistungsfarben werden später gegen die Manager-Ziele berechnet und nicht als feste Erfolgsbehauptung aus den Rohzahlen abgeleitet.

### Opening und Follow-up

Berücksichtigte Aktivitätstypen:

- `1.📞 Opening Call` – `actitype_3YiimGlbRMzQxr2O3hPKHJ`
- `2.☎️ Follow Up - Setter & Closer` – `actitype_38qU8FYNxY0WkWAy66Uc65`

| KPI | Regel |
|---|---|
| Gatekeeper-Kontakte | Gatekeeper-Ergebnis ist gesetzt und nicht `🛑 Kein Gatekeeper` |
| Durchstellungen | Gatekeeper-Ergebnis ist exakt `✅ Durchgestellt` |
| Direkter Entscheider | Gatekeeper-Ergebnis ist exakt `🛑 Kein Gatekeeper` |
| Entscheider erreicht | Entscheider-Ergebnis ist gesetzt |
| Termine | Entscheider-Ergebnis ist `4: ✅ Termin vereinbart` oder `Entscheider: Termin vereinbart` |
| Produkt/Kampagne | Bedarf aus `Entscheider Info: Welcher Bedarf?` |

Quoten:

- Durchstellquote = Durchstellungen / Gatekeeper-Kontakte
- Entscheiderquote = Entscheider erreicht / Netto-Calls
- Terminquote = Termine / Entscheider erreicht

### Technisch vorbereitet, zunächst nicht sichtbar

| KPI | Close-Quelle | Regel |
|---|---|---|
| Setter Calls | `3.✅ Setter Call` | Jede veröffentlichte Aktivität |
| Setter-Erfolge | Ergebnis Setter Call | `✅ Closer terminiert` |
| Closer Calls | `4.⭐️ Closer Call` | Jede veröffentlichte Aktivität |
| Closer-Verkäufe | Ergebnis Closer Call | `1. ✅ Verkauft - in CC1` oder `3. ✅ Verkauft - in CC2 🔥` |
| No Shows | `5.🔄 No Show` | Setter- oder Closer-Wert `Nicht erschienen` |
| Absagen | `5.🔄 No Show` | Setter- oder Closer-Wert `⛔ Abgesagt` |
| Verschoben | `5.🔄 No Show` | Setter- oder Closer-Wert `🔄 Termin verschoben` |

Absagen und verschobene Termine werden nicht als No Show gewertet.

### Deals und Umsatz

- Quelle ist die Pipeline `Sales` (`pipe_42eLhfS7p2vd5Fjw2ou2Sw`).
- Gewonnen sind ausschließlich `Kunde` und `Upsell/Verlängerung`.
- Der Stichtag ist das offizielle Opportunity-Feld `date_won`.
- Umsatz ist der Opportunity-Wert `value` in Cent; der Wert wird nicht von KI berechnet.
- `value_period` wird mitgespeichert. Aktuell geprüfte gewonnene Opportunities sind `one_time`; abweichende Perioden werden später als Mapping-Warnung protokolliert.

### Abruf aus Close

Die Typ-Endpunkte `/activity/call/` und `/activity/custom/` sortieren fest nach `date_created` und kennen keinen `_order_by`-Parameter. Ein `activity_at`-Filter wird deshalb mit `400` abgelehnt: `"activity_at" filtering can not be used together with "date_created" sorting`. Sortierung nach `-activity_at` ist laut Close-Doku nur beim Abruf eines einzelnen Leads möglich.

Der Sync ruft daher nach `date_created` ab, mit zwei Tagen Puffer vor und nach dem Berichtszeitraum, und entscheidet die Tageszuordnung anschließend selbst anhand von `activity_at`. Die fachliche Regel bleibt damit unverändert: Eine Kennzahl zählt an dem Tag, an dem das Gespräch stattfand, nicht an dem Tag, an dem es erfasst wurde.

Der Puffer von zwei Tagen ist am 2026-09-02 festgelegt worden, weil Protokolle grundsätzlich direkt nach dem Gespräch und in jedem Fall am selben Tag erfasst werden. Er deckt verspätete Einträge und den Versatz zwischen `Europe/Berlin` und UTC ab.

`custom_activity_type_id` lässt sich nicht als Filter verwenden: Close verlangt dafür zwingend ein einzelnes `lead_id`. Die Typauswahl passiert deshalb beim Mapping, nicht beim Abruf.

### Supabase-Ebenen

1. `close_raw_activities`: gekürzte Close-Rohantwort zur Nachprüfung.
2. `close_activity_facts`: pro Aktivität normalisierte KPI-Flags mit Mapping-Version.
3. `close_opportunity_facts`: gewonnene Opportunity mit Opener-/Setter-/Closer-Zuordnung.
4. `close_newsletter_subscriptions`: Status des freigegebenen Newsletter-Workflows, ausschließlich serverseitig lesbar.
5. `daily_sales_metrics`: verdichtete Tageswerte pro Vertriebler.
6. `monthly_kpi_snapshots`: unveränderlicher Monatsabschluss mit acht relevanten Roh-KPIs pro Vertriebler.
7. Dashboard-Funktionen: exakte Tag-, Woche- und Monatswerte sowie Drei-Monats-Trend.

Alle Ebenen nutzen ein rollierendes Fenster aus aktuellem Monat und zwei Vormonaten.

### Monatsabschlüsse

Die operative Tabelle `daily_sales_metrics` wird nach drei Monaten bereinigt. Unabhängig davon wird einmal je abgeschlossenem Monat ein fester Datensatz in `monthly_kpi_snapshots` angelegt. Er enthält: Brutto-Anrufe, Netto-Anrufe, Vorzimmer-Kontakte, Durchstellungen, direkte Entscheider, Entscheider gesamt, Termine und Newsletter-Abschlüsse. Netto-, Durchstell- und Terminquote bleiben daraus stets exakt berechenbar.

Der Datenbank-Job startet täglich um 00:05 UTC und schreibt nur dann, wenn es in `Europe/Berlin` der erste Kalendertag ist. So wird der vollständige Vormonat nach dem letzten stündlichen Close-Sync gesichert. Bereits vorhandene abgeschlossene Monate werden bei Einführung einmalig nachgezogen; vorhandene Snapshots werden nicht überschrieben.

## Missing Context

- Falls künftig Opportunities mit `monthly` oder `annual` auftreten, muss festgelegt werden, ob das Dashboard Vertragswert, MRR oder ARR zeigt.
- Brutto-/Netto-Regel und Opportunity-Zuordnung müssen anhand eines vollständigen manuellen Testtags bestätigt werden.

## Sources

- Close Plugin: aktive Organisationsbenutzer am 2026-09-02.
- Close Plugin: Call-Felder und reale Call-Beispiele von Michael und Felix am 2026-09-01 und 2026-09-02.
- Close Plugin: aktive Custom-Activity-Typen und konkrete veröffentlichte Beispiele.
- Close Plugin: Pipeline `Sales`, Won-Status und gewonnene Opportunities.
- Close Plugin: Lead-Felder `3.01 Opener`, `3.02 Setter` und `3.03 Closer` auf gewonnenen Leads.
- Close Workflow-Report `Newsletter` (`seq_1CghCZOXaNSlwDSOIpljTy`), am 2026-09-03 read-only geprüft: „Completed“ umfasst Ziel erreicht oder Workflow beendet.
- [Close API: Sequence Subscriptions](https://developer.close.com/api/resources/sequences/list-subscriptions).

## Timeline

- 2026-09-02: Organisation, Benutzer, Call-Felder, Custom Activities und Pipelines read-only geprüft.
- 2026-09-02: Wettbewerbszuordnung über `3.01 Opener` festgelegt.
- 2026-09-02: Mapping-Version `2026-09-02.v1` lokal angelegt.
- 2026-09-02: Sichtbaren MVP-Umfang auf Brutto, Netto, Anrufzeiten, Vorzimmer, Entscheider, Termine und Newsletter begrenzt.
- 2026-09-03: Newsletter-Quelle auf den freigegebenen Close-Workflow festgelegt; Abschlussstatus `goal` und `finished` werden Michael/Felix über den Ersteller der Anmeldung zugerechnet.
- 2026-09-03: KPI- und Zeitraumvertrag präzisiert: sechs Kernwerte, Nettoquote aus Brutto/Netto, Terminquote aus Entscheider/Termine, Wochenansicht Montag bis Freitag und Stundenanzeige 08:00 bis 17:00.
- 2026-09-03: Dauerhafte Monatsabschlüsse als eigene, schlanke Tabelle festgelegt; der automatische Lauf sichert den Vormonat am ersten lokalen Kalendertag.
- Nächster Schritt: Einen vollständigen Testtag gegen Close zählen und die erste produktive Stunden-Synchronisierung kontrollieren.
