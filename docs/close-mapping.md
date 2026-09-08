# Close Mapping für das Vertriebsdashboard

## Current Truth

### Release 2026-09-08: KPI-Abgleich und Vertriebspipeline

Der Nutzer hat die produktive Übernahme am 08.09. ausdrücklich freigegeben. Mapping `2026-09-07.antony-reconciliation` ist als `close-sync` Version 77 ausgerollt, `weekly-review` als Version 11 und `kpi-assistant` als Version 4. Migrationen: `20260908071339_reconcile_antony_kpis.sql`, `20260908071341_add_antony_process_metrics.sql`, `20260908071707_fix_lead_snapshot_delete_guard.sql`. Die Dateinamen entsprechen den tatsächlich angewandten Migrationen.

Vollständiger Dry Run erfolgreich. Nach Anpassung an die produktive Safe-Update-Regel wurde der Abgleich vom 01.07. bis 08.09. erfolgreich geschrieben. Der erste echte Cron-Lauf mit dem neuen Mapping startete am 08.09. um 09:22 Uhr Berlin und endete um 09:23 Uhr erfolgreich. Cron läuft unverändert alle 15 Minuten. Die Berechtigungen wurden live mit Antony, info und zwei anderen Konten geprüft: nur die bestehenden zwei Freigaben können das neue Prozess-RPC verwenden. Die bereinigte Durchstellquote einschließlich „GF nicht erreichbar“ bleibt erhalten.

Die Oberfläche dieses Releases stellt den Prozess als fünf verbundene, aufklappbare Stufen dar. Quelle und Terminlieferant lassen sich filtern; auf schmalen Bildschirmen läuft die Pipeline vertikal. Zusatzresultate vor/im Setter und vollständige Tabellen bleiben zugänglich. Die Hauptlinie zählt nur im Zeitraum gebuchte Leads, nicht sämtliche Periodenergebnisse aus früheren Buchungen. Cache-Tag: `2026-09-08-sales-pipeline`.

Close bleibt alleinige operative Quelle. Das Sheet dient zur Prüfung der fachlichen Definitionen, wird nicht importiert und löst keine zusätzliche manuelle Pflege aus. Details zum Quellenvergleich und die private Backfill-Vorschau liegen im Prüfbericht der aktuellen Aufgabe; sensible Einzeldaten gehören nicht in dieses Repository.


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
| Beste Anrufzeiten | Call Activity und Opening/Follow-up | Pro Stunde in `Europe/Berlin`: produktive Erreichbarkeit, Durchstell-, Entscheider- und Terminquote; kleine Stichproben werden zum persönlichen Periodenmittel geglättet |
| Mailbox | Call Outcome | Outcome-ID `outcome_030sp0X2TRtdT8YPJfqwWS` (`📮 Mailbox`) |
| Außerhalb Geschäftszeit | Call Outcome | Outcome-ID `outcome_030spLYZrlWBQ9kEiPfudv` (`⌛️ außerhalb der Geschäftszeiten`) |

### Zeit- und Zeitraumlogik

- Der Tag einer Aktivität und ihre Stunde stammen aus Close `activity_at`, vor dem Speichern nach `Europe/Berlin` umgerechnet. Die Uhrzeit des stündlichen Syncs verändert keine Kennzahl.
- **Tag** zeigt exakt den ausgewählten Kalendertag. Antonys Tagesverlauf enthält mindestens **08:00 bis 17:00** und erweitert sich bis zur frühesten/spätesten tatsächlich vorhandenen Aktivität. Leere Stunden bleiben sichtbar.
- **Woche** zeigt Montag bis Stichtag, maximal Freitag; Samstag und Sonntag gehören nicht in die Vertriebswoche.
- **Monat** beginnt am Ersten und endet am Stichtag, bei einem abgeschlossenen Monat am letzten Kalendertag. Die Trendtabelle zeigt den aktuellen sowie die zwei vorherigen Monate.
- Nettoquote = Summe Netto-Anrufe / Summe Brutto-Anrufe. Durchstellquote = Summe Durchstellungen / Summe Vorzimmer-Kontakte. Terminquote = Summe Termine / Summe Entscheiderkontakte. Das Dashboard bildet nie Mittelwerte aus Einzelquoten.
- Stunden ohne Grundgesamtheit zeigen bei Quoten einen Strich statt `0 %`. Stunden mit weniger als drei Kontakten bleiben sichtbar, werden aber als zu kleine Basis gedämpft und nicht als Empfehlung behandelt.
- Die Stunden-Gesamtqualität gewichtet produktive Erreichbarkeit mit 35 %, Durchstellung mit 25 % sowie Entscheider- und Terminquote mit je 20 %. `Mailbox` und `außerhalb der Geschäftszeiten` werden dabei von den technisch als beantwortet gemeldeten Calls abgezogen. Diese Klassifizierung gilt ausschließlich für die Stundenempfehlung und verändert Anrufe brutto, Anrufe netto oder deren Quote nicht.

`created`, `in-progress` und `cancel` zählen nicht als abgeschlossener Versuch. Durch die überlappenden Sync-Fenster werden zwischenzeitlich laufende Calls beim nächsten Sync erneut geprüft.

### KPI-Umfang des ersten Dashboards

Im ersten produktiven Stand werden nur folgende Werte sichtbar gemacht:

1. Anrufe brutto
2. Anrufe netto
3. Intelligente Stundenqualität aus produktiver Erreichbarkeit, Durchstell-, Entscheider- und Terminquote; Mailbox und außerhalb der Geschäftszeiten als Negativ-Outcomes
4. Vorzimmer-Kontakte
5. Durchstellungen und Durchstellquote
6. Entscheiderkontakte, zusätzlich getrennt nach direkt erreicht und durchgestellt
7. Termine und Terminquote
8. Newsletter versendet

Die Einzelquoten bleiben umschaltbar. Die Gesamtqualität beantwortet die Steuerungsfrage, wann aus einem Anruf mit belastbarer Basis am ehesten ein produktiver Entscheiderkontakt und Termin entsteht.

Deals und Umsatz werden weiterhin importiert und in Supabase vorgehalten, aber **nicht angezeigt**. Die offene Frage nach Vertragswert, MRR oder ARR bei `monthly`/`annual` bleibt damit vertagt, bis der Umsatz sichtbar werden soll.

### Newsletter versendet

- Quelle sind ausgehende E-Mail-Aktivitäten des Close-Workflows `Newsletter` (`seq_1CghCZOXaNSlwDSOIpljTy`) mit `status=sent` und gültigem `date_sent`.
- Jede eindeutige E-Mail-ID zählt einmal. Mehrere versendete Schritte desselben Workflows zählen einzeln; Anmeldungen, Ziele und Workflow-Abschlüsse zählen nicht.
- Der KPI-Tag ist das tatsächliche Versanddatum `date_sent` in `Europe/Berlin`, die Zuordnung erfolgt über den E-Mail-Nutzer `user_id`.
- Entwürfe, geplante, wartende, fehlgeschlagene und eingehende E-Mails sowie andere Workflows bleiben ausgeschlossen. Versand bedeutet nicht bestätigte Zustellung.
- Nur Versandmetadaten werden gelesen; Nachrichteninhalte und Empfänger werden nicht importiert. Die vollständige paginierte Metadatenabfrage erfasst auch spät versendete alte Entwürfe. Bei mehr als 20.000 E-Mails bricht der Import ohne Teilabgleich ab.
- Ein atomarer Abgleich ersetzt die Versandereignisse und ausschließlich die Newsletter-KPI der rollierenden drei Monate. Bereits archivierte volle Monate dieses Fensters erhalten korrigierte Newsletter-Summen; andere Kennzahlen bleiben erhalten.
- E-Mails ohne passende `sales_people`-Zuordnung werden nicht willkürlich einem Vertriebler zugerechnet.

Leistungsfarben stützen sich auf `sales_targets`. Die Tabelle wurde um `calls_gross`, `gatekeeper_contacts`, `transfer_rate_target` und `appointment_rate_target` erweitert, damit jede sichtbare Zahl ein eigenes Ziel bekommen kann. Die beiden Quotenziele sind nullable: kein Ziel ist etwas anderes als ein Ziel von null Prozent. Ohne gesetztes Ziel bleibt eine Zahl neutral eingefärbt statt rot.

Michael wird blau (`#4f8cff`) und Felix orange (`#f59e0b`) dargestellt. Leistungsfarben werden später gegen die Manager-Ziele berechnet und nicht als feste Erfolgsbehauptung aus den Rohzahlen abgeleitet.

### Opening und Follow-up

Berücksichtigte Aktivitätstypen:

- `1.📞 Opening Call` – `actitype_3YiimGlbRMzQxr2O3hPKHJ`
- `2.☎️ Follow Up - Setter & Closer` – `actitype_38qU8FYNxY0WkWAy66Uc65`

| KPI | Regel |
|---|---|
| Gatekeeper-Kontakte | Bewertbares Ergebnis: `✅ Durchgestellt`, `Nicht durchgestellt`, `E-Mail senden` oder `Kein Interesse`; Nichterreichbarkeit einschließlich GF/CEO nicht erreichbar, Mailbox, außerhalb der Geschäftszeiten, direkte Entscheider und unbekannte Ergebnisse ausgeschlossen |
| Durchstellungen | Gatekeeper-Ergebnis ist exakt `✅ Durchgestellt` |
| Direkter Entscheider | Gatekeeper-Ergebnis ist exakt `🛑 Kein Gatekeeper` |
| Entscheider erreicht | Ausschließlich die in `DECISION_MAKER_RESULTS` explizit erlaubten Ergebnisse; Trennlinien, leere und unbekannte Werte zählen nicht |
| Termine | Entscheider-Ergebnis ist `4: ✅ Termin vereinbart` oder `Entscheider: Termin vereinbart` |
| Produkt/Kampagne | Bedarf aus `Entscheider Info: Welcher Bedarf?` |

Quoten:

- Durchstellquote = Durchstellungen / Gatekeeper-Kontakte
- Entscheiderquote = Entscheider erreicht / Netto-Calls
- Terminquote = Termine / Entscheider erreicht

### Setter-/Closer-Ereignisse

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

### Closer-Stufe für Antony

- Termine und Setter zählen die veröffentlichten Aktivitäten von Michael, Felix **und Antony**, zugeordnet über `activity.user_id`. Die Michael/Felix-Wettbewerbsansichten behalten ihren bisherigen Personenumfang.
- Closer Calls, CC2 und Verkäufe zählen nur Antonys veröffentlichte Closer-Aktivitäten. Jede eindeutige Activity-ID zählt einmal; mehrere reale Gespräche desselben Leads bleiben mehrere Ereignisse.
- Setter-Conversion = `Closer terminiert / Setter Calls`. Eine echte Teilnahmequote hätte die für den Terminzeitraum angesetzten Gespräche als Nenner. Diese Termin-Kohorte ist aus den geprüften Daten nicht vollständig verfügbar.
- `Closer durchgeführt / Closer terminiert`, `Setter Calls / neue Termine` und `Neukunden / neue Termine` sind **Zeitraumverhältnisse**, keine Teilnahme- oder Kohortenquoten. Gespräche und Buchungen können aus verschiedenen Perioden stammen; Werte über 100 % werden nicht abgeschnitten.
- CC2-Quote = `CC2 vereinbart / Closer Calls`. `2. 🔥 CC2 vereinbart` ist eine offene Fortsetzung, kein Verkauf und kein Verlust.
- Am 08.09. vom Nutzer bestätigte fachliche Regel: Closer-Abschlussquote = `Verkauft / explizit entschiedene Closer Calls`. Nur die zwei Verkauft-Ergebnisse und `4. ❌ Nicht verkauft` sind entschieden; fehlende Ergebnisse zählen nicht als Verlust. Die davon abweichende CC1-Basis im Sheet wird ausdrücklich nicht übernommen.
- Neukunden zählen Won-Opportunities mit Status `Kunde` und Antony im Lead-Feld `3.03 Closer`. `Upsell/Verlängerung` zählt weiterhin im gespeicherten Deal-/Umsatzbestand, aber nicht als Neukunde. Die Zähleinheit ist die eindeutige Opportunity-ID; sie ist keine belegte Erstkundenhistorie pro Firma.
- Fehlender Opener darf einen zugeordneten Closer-Abschluss nicht löschen. Der Opener bleibt dann null; es wird kein Wettbewerbsergebnis erfunden.
- Alle Ereignisse werden nach `activity_at`, Won-Ergebnisse nach `date_won`, in `Europe/Berlin` eingeordnet. Ein datumsloser Abschluss wird nicht geschätzt. Date-only-Won-Werte haben keine belegte Abschlussuhrzeit und werden im Tagesgraphen nicht künstlich einer Stunde zugerechnet.
- Quoten ohne Nenner sind null und erscheinen als Strich. Ein echter Zähler von null bei vorhandenem Nenner bleibt 0 %.
- Die bestehende serverseitige Berechtigung über `has_antony_access()` und private Freigaben bleibt unverändert. Kein Zugriff allein durch Auswahl des Antony-Reiters.

### Pipeline, Monatsmodell und KI

Die offene Strecke ist eine aus den aufbewahrten Ereignissen abgeleitete Momentaufnahme pro Lead, keine vollständige Opportunity-Pipeline oder historische Statuschronik. Spätere Durchführung, Absage oder No-Show beendet den früheren offenen Terminstatus; ein späterer Abschluss beendet den offenen CC2-Status. Won-Leads werden ausgeschlossen. Das Alter wird nach Berliner Kalenderdatum bestimmt. Außerhalb des Aufbewahrungsfensters entstandene offene Fälle können fehlen.

Das Monatsmodell ist eine Simulation aus Ereigniszahlen, Arbeitstagstempo und eingegebenem Kundenwert. „Modellwert bisher“ = Neukunden × Kundenwert, kein tatsächlicher CRM-Umsatz. Es beweist keine kausale Conversion zwischen unabhängigen Monatsereignissen. Ohne belastbare Modellrate wird keine Prognose erfunden.

Wochenbericht und KPI-Assistent erhalten dieselben deterministisch berechneten Zähler und Regeln (`KPI_RULES`). Setter-Erfolg heißt `setter_conversion_rate`, keine Showrate. Zeitraumverhältnisse werden entsprechend benannt; fehlende Nenner erzeugen weder 0-%-Bewertungen noch Prozentpunkttrends. Auch fehlende Mengen bleiben null; ein unvollständiger Personenbestand wird nicht als vollständige Teamsumme ausgegeben. Die KI darf aus periodenfremden Mengen keinen belegten Funnelverlust ableiten. Der bestehende Zeitplan, fünf Bulletpoints und die private Anzeige werden nicht verändert.

### Leadqualität und vollständiger Prozess bis zum Neukunden

Fachlich am 08.09. bestätigt: Die Abschlussquote verwendet **entschiedene Gespräche**. Leadqualität bewertet die **Vorqualifizierung des Terminlieferanten**: Welche seiner gebuchten Leads kommen tatsächlich in den Setter und mit welchem Ergebnis? Auswertung nach Leadquelle und Terminlieferant; der Platzhalter „Leadqualität ????“ ist keine unbekannte zusätzliche Person.

Die neue geschützte Funktion `get_antony_process_metrics` liefert für Tag, Woche, Kalendermonat und `three_months` dieselben Ereignisse in Berlin. Der Drei-Monats-Bereich umfasst den gewählten Monat und die zwei Vormonate bis zum Stichtag und erscheint in Antony nur in der Monatsansicht. Zwei Betrachtungen bleiben ausdrücklich getrennt:

| Betrachtung | Zählung / Zuordnung | Aussage |
|---|---|---|
| Gebuchte Leads | Pro Zeitraum eindeutige `lead_id`, erste dokumentierte Buchung im Zeitraum; deren `user_id` ist Terminlieferant. Gleichzeitige widersprüchliche Bucher bleiben nicht zugeordnet. | Gebucht → tatsächlich im Setter → qualifiziert / Follow-up / disqualifiziert / Ergebnis fehlt. Ergebnisse nur nach Buchung und bis Stichtag. Wiederholte Buchungen zählen einmal. |
| Anteil im Setter | Eindeutige gebuchte Leads mit späterem Setter / eindeutige gebuchte Leads | Fortschritt dieser Buchungsgruppe, keine bereinigte Showrate: Noch nicht fällige Termine können enthalten sein. |
| Alle bearbeiteten Setter-Leads | Letztes Setter-Ergebnis je eindeutigem Lead im Zeitraum, auch aus älteren Buchungen; letzter dokumentierter vorheriger Terminbucher ist Lieferant | Qualifiziert / im Setter verwendet diese eindeutigen Leads; mehrere Setter-Follow-ups blähen die Grundgesamtheit nicht auf. Gleichzeitige widersprüchliche Ergebnisse bleiben unbewertet. |
| Ersatzzuordnung | Fehlt eine frühere Buchungsaktivität im gespeicherten Fenster: aktuelles `3.01 Opener`, sichtbar als „Aktueller Opener (Ersatz)“ | Keine behauptete historische Activity-Owner-Zuordnung. Andere CRM-Nutzer werden als weitere Terminlieferanten zusammengefasst, unbekannte Zuordnungen bleiben unbekannt. |
| Leadquelle | Aktuelles `1.02 Leadquelle`, Feld `cf_2CMz3g4iGjEjeWmrbouveHjdBsMHaLttdpV4vrgVurd`; nur bekannte Auswahlwerte, sonst nicht zugeordnet | Kein Rückschluss auf eine historisch andere Quelle; keine frei erfundene Qualitätsnote. |
| Noch nicht im Setter | Letzter dokumentierter Setter-Terminstatus nach Buchung: nicht erschienen / abgesagt / verschoben / noch kein Setter oder Status | Frühere No-Shows zählen hier nicht mehr als Ausfall, sobald der Lead später im Setter war. Keiner dieser Zustände gilt automatisch als disqualifiziert. |
| Weitere Stufen der Buchungsgruppe | Später durchgeführter Closer, explizit verkaufter Closer Call, Won-Status `Kunde` nach Buchung und bis Stichtag; je Lead einmal | Tatsächlich verknüpfte Prozessfortschritte; Verkauf laut Gespräch und Won sind getrennte Nachweise und können voneinander abweichen. |
| Periodenereignisse | Follow-up-Kontakte mit vier getrennten Ergebnissen; Setter-Ergebnisse; No-Show/Absage/Verschiebung jeweils Setter und Closer; CC1-Verkäufe, CC2-Vereinbarungen, CC2-Verkäufe, explizit nicht verkauft, fehlendes Ergebnis | Aktivitäten zählen einzeln. Offene Follow-ups und CC2 sind keine Verluste; eine Vereinbarung beweist nicht, dass sie heute noch offen ist. |

Aktivitäten umfassen die drei bekannten Nutzer. Die Closer-Periodenkennzahlen betreffen weiterhin Antony. Für den Terminpfad werden Folgestufen desselben Leads aus den drei Nutzern verfolgt; Won zählt dort pro Lead, während die bestehenden Antony-Kundenabschlüsse Opportunities mit `3.03 Closer=Antony` zählen. Keine globale Erstkundenhistorie wird behauptet.

`close_lead_reporting` speichert nur Lead-ID, aktuelle Quellkategorie, Opener-ID und Abrufzeit. Sie hat RLS, keine Browser-Leserechte und wird zusammen mit Custom/Won atomar ersetzt. Für jeden Setter-, Buchungs- und Won-Lead muss der Metadatenabruf abgeschlossen sein; Fehler verhindern den Abgleich. Das Aggregat-RPC verwendet denselben serverseitigen Antony-Zugang wie die bestehenden privaten Auswertungen. Es werden keine Berechtigungen erweitert.

Die KI erhält nur freigegebene Kategorien, aggregierte Mengen und deterministisch berechnete Quoten dieses Moduls. Keine Lead-IDs, Namen, E-Mails oder Notizen gehen ans Modell. KI-Assistent und Wochenbericht lesen dieselben Prozess-RPCs und dürfen offene Termine oder kleine Stichproben nicht als bewiesene schlechte Vorqualifizierung auslegen.

### Abruf und wiederholbarer Abgleich aus Close

Calls behalten den bestehenden Abruf nach Erstellungsdatum mit zwei Tagen Puffer; die Zuordnung erfolgt ausschließlich nach `activity_at`. Der Typ-Endpunkt akzeptierte im geprüften Setup keine davon abweichende `activity_at`-Sortierung über mehrere Leads.

**Custom Activities:** Alle Seiten für die drei bekannten Benutzer werden ohne Erstellungsdatum-Grenze geladen, nur mit den benötigten IDs, Zeitstempeln, Status- und Auswahlfeldern. Danach wird anhand von `activity_at` auf den aktuellen Monat plus zwei Vormonate bis einschließlich heute in Berlin gefiltert. Eine am 26.08. angelegte und erst am 03.09. veröffentlichte Aktivität belegt, dass der bisherige Zwei-Tage-Puffer hierfür nicht genügt. Typen werden anhand stabiler IDs lokal ausgewählt.

**Won-Opportunities:** Beide Won-Status werden für das Retentionsfenster einschließlich UTC-Randpuffer gelesen, die endgültige Grenze bestimmt das Berliner Won-Datum. Attribution wird anhand der aktuellen Lead-Felder gelesen. Fehlende Opener bleiben null; ungültige oder unvollständig geladene Datensätze brechen den Abgleich ab.

Erst nach vollständiger Pagination und Validierung ersetzt die ausschließlich für `service_role` aufrufbare Funktion `reconcile_close_custom_and_won` die Custom-/Won-Daten des gesamten Retentionsfensters atomar. Auch ein manueller Call-Import für einen einzelnen historischen Tag gleicht Custom/Won stets bis **heute** ab; dadurch bleiben auf andere Tage verschobene Ereignisse konsistent. Entwürfe, Löschungen, neue Zuordnungen und nicht mehr gewonnene Opportunities verschwinden aus dem betroffenen Faktenbestand. Eindeutige IDs verhindern Duplikate. Eine Transaktionssperre und Snapshot-Reihenfolge verhindern, dass ein älterer Abruf neuere Daten überschreibt. Pagination-/Validierungsfehler ergeben keinen Teilabgleich. Calls und Newsletter behalten ihre separaten Quellen.

Ein Schreibimport ist kein reines Neuberechnen alter Summen: Fehlende Aktivitäten müssen zuerst aus Close nachgeladen werden. `scripts/preview-closing-backfill.mjs` ist eine ausschließlich lokale, lesende Vergleichsvorschau für den geprüften Juli–September-2026-Datensatz. Dieser reduzierte Setter-/Closer-Datensatz darf **nicht** als vollständiger produktiver Importpayload verwendet werden.

### Supabase-Ebenen

1. `close_raw_activities`: gekürzte Close-Rohantwort zur Nachprüfung.
2. `close_activity_facts`: pro Aktivität normalisierte KPI-Flags mit Mapping-Version.
3. `close_opportunity_facts`: gewonnene Opportunity mit Opener-/Setter-/Closer-Zuordnung.
4. `close_newsletter_sends`: tatsächlich versendete Newsletter-E-Mails, ausschließlich serverseitig lesbar. `close_newsletter_subscriptions` bleibt als Altbestand erhalten und ist keine KPI-Quelle mehr.
5. `daily_sales_metrics`: verdichtete Tageswerte pro Vertriebler.
6. `monthly_kpi_snapshots`: Monatsabschluss mit acht relevanten Roh-KPIs für das gesamte Team.
7. Dashboard-Funktionen: exakte Tag-, Woche- und Monatswerte sowie Drei-Monats-Trend.

Operative Rohdaten, Facts und Tageswerte nutzen ein rollierendes Fenster aus aktuellem Monat und zwei Vormonaten. Die getrennten Monatsarchive bleiben darüber hinaus erhalten.

### Monatsabschlüsse

Die operative Tabelle `daily_sales_metrics` wird nach drei Monaten bereinigt. Unabhängig davon wird einmal je abgeschlossenem Monat ein fester Datensatz für das **gesamte Team** in `monthly_kpi_snapshots` angelegt. Er enthält: Brutto-Anrufe, Netto-Anrufe, Vorzimmer-Kontakte, Durchstellungen, direkte Entscheider, Entscheider gesamt, Termine und versendete Newsletter. Netto-, Durchstell- und Terminquote bleiben daraus stets exakt berechenbar. Die Tabelle ist Backend-only und wird vom Dashboard nicht abgefragt.

Der Datenbank-Job startet täglich um 00:05 UTC und schreibt nur dann, wenn es in `Europe/Berlin` der erste Kalendertag ist. So wird der vollständige Vormonat nach dem letzten Close-Sync gesichert. Bereits vorhandene abgeschlossene Monate werden bei Einführung einmalig nachgezogen; vorhandene Snapshots werden im normalen Abschlussjob nicht überschrieben. Der freizugebende Korrekturabgleich aktualisiert ausschließlich die Custom-KPIs vollständig enthaltener Monate innerhalb der Retention. Anruf- und Newsletter-Archivwerte bleiben dabei erhalten. Ältere Archive werden nicht verändert.

## Missing Context

- Das Sheet enthält aggregierte Wochenwerte und manuelle Eingaben, keine vollständigen täglichen Termin-Kohorten mit stabilen Lead-IDs. Eine echte historische Teilnahme-/Kohortenquote ist damit nicht durchgehend nachweisbar.
- Historische Rollenwechsel, gelöschte Aktivitäten und frühere Opportunity-Status außerhalb der Retention sind aus dem aktuellen CRM-Zustand allein nicht rekonstruierbar. Ein Backfill kann nur die heute noch vorhandenen Quellen herstellen.
- Ein zusätzliches Close-Feld für das ursprüngliche Datum existiert; in den geprüften Beispielen widerspricht es `activity_at` nicht. Ein zukünftiger Widerspruch darf nicht still durch einen Datumstausch aufgelöst werden.
- Vollständiger Import und echter Cron-Lauf sind am 08.09. geprüft (rund 82–86 Sekunden). Die feste Grenze von 20.000 Datensätzen pro Ressource bleibt ein Abbruchschutz; bei weiterem Wachstum ist die Abrufstrategie erneut zu prüfen.

- Falls künftig Opportunities mit `monthly` oder `annual` auftreten, muss festgelegt werden, ob das Dashboard Vertragswert, MRR oder ARR zeigt.
- Brutto-/Netto-Regel und Opportunity-Zuordnung müssen anhand eines vollständigen manuellen Testtags bestätigt werden.

## Sources

- Nutzerantworten vom 08.09.: entschiedene Closer-Gespräche als Basis; Leadqualität je Quelle und tatsächlichem Terminlieferant bis in den Setter.
- Close-Leadfelder und Setter/Closer/Follow-up/No-Show-Auswahlwerte am 08.09. erneut lesend geprüft; reales Beispiel Terminbuchung Michael am 02.09. → Setter Antony am 04.09. (LinkedIn, Setter Follow Up).
- `supabase/migrations/20260908071341_add_antony_process_metrics.sql`: private Prozessauswertung mit Buchungskohorten.

- [Social Profit GmbH – CRM & KPI Liste 2026](https://docs.google.com/spreadsheets/d/1uV9njfRCZvHPFEocLe3Bd6Mww7hcmS2HG2WcYRuorrA/edit): Tabs `Leads & Umsatz`, `Setter Erreichbarkeit`, `Setter Quote`, `Closer Qoute`, Formeln und Werte read-only am 07.09.2026 geprüft.
- [Close Activity API](https://developer.close.com/api/resources/activities/list) und [Custom Activities](https://developer.close.com/api/resources/activities/custom-activities/list); tatsächliche Felder, Benutzer, Aktivitäts-IDs und Won-Opportunities read-only geprüft.
- `supabase/functions/_shared/close-reconciliation.ts`, `supabase/migrations/20260908071339_reconcile_antony_kpis.sql`, `tests/kpi-reconciliation.test.ts`, `tests/verify-kpi-sql.mjs`.

- Close E-Mail-API: https://developer.close.com/api/resources/activities/emails/list (am 2026-09-07 geprüft).

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
- 2026-09-03: Dauerhafte Monatsabschlüsse als eigene, schlanke Backend-Tabelle für das gesamte Team festgelegt; der automatische Lauf sichert den Vormonat am ersten lokalen Kalendertag.
- 2026-09-04: Closer-Stufe als eigener vierter Reiter neben Felix vorläufig für alle Dashboard-Nutzer freigegeben; kompakte Kreisdiagramme bilden Setter-, Closer-, CC2- und Gesamtconversion ab. CC2 bleibt aus dem Abschlussquoten-Nenner entfernt.
- Nächster Schritt: Einen vollständigen Testtag gegen Close zählen und die erste produktive Stunden-Synchronisierung kontrollieren.

- 2026-09-07: Newsletter-KPI von Workflow-Abschlüssen auf tatsächliche E-Mail-Versandereignisse umgestellt.

- 2026-09-07: Bereinigte Durchstellquote: nur vier bewertbare Vorzimmer-Ergebnisse bilden die Grundgesamtheit. Bestehende Fakten, Tageswerte und aufbewahrte Monatsarchive werden korrigiert; Stunden, Wochen und drei Monate verwenden dieselben Fakten. Datenbank-Trigger schützt die Regel auch bei älteren Importern.

- 2026-09-07: „GF nicht erreichbar“ wird wie „CEO nicht erreichbar“ aus der Grundgesamtheit der Durchstellquote ausgeschlossen. Das gilt automatisch für alle Zeiträume und Stundenanalysen; der Anrufversuch bleibt in der Anrufanzahl enthalten.

- 2026-09-07/08: Antony-KPI-Audit gegen Sheet-Formeln, Close-Einzelaktivitäten und produktive SQL-Definitionen. Lokale Korrektur einschließlich Retentionsabgleich, Rollen, Nullquoten, CC2-Entscheidungen, später Stunden und KI-Regeln vorbereitet; keine produktive Übernahme.

- 2026-09-08: Fachliche Antworten aufgenommen, Leadqualität je Quelle/Terminlieferant und gesamter dokumentierter Prozess ergänzt. 57 Node-Tests, beide lokalen SQL-Migrationen, echte Buchung/Setter-Verknüpfung, vier Zeiträume, private Rechte, KI-Whitelist und Browserdarstellung geprüft; weiterhin nicht produktiv.

- 2026-09-08: Nutzerfreigabe zur Live-Übernahme. Backend-Migrationen und drei Edge Functions ausgerollt; einmaliger Retentionsabgleich und erster automatischer Cron-Lauf erfolgreich. Die produktive Safe-Update-Erweiterung verlangte beim vollständigen Metadatenersatz eine WHERE-Klausel; eigener Nachtrag angewandt. Der zuvor fehlgeschlagene atomare Versuch wurde zurückgerollt.
- 2026-09-08: Auf Nutzerwunsch übersichtliche, filterbare Pipeline ergänzt. Browserprüfung: fünf Stufen, Tastaturdetails, kombinierte Quellen-/Lieferantenfilter, Null-/fehlende Daten, echte SQL-Aggregate, 900/390 px ohne Seitenüberlauf, bestehende Graph-Popups und Team-Isolation.
