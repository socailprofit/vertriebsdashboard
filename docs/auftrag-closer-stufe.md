# Auftrag — Closer-Stufe und Conversions ins Dashboard

Erstellt 2026-09-03. Alle IDs und Auswahlwerte unten sind am selben Tag **read-only in Close verifiziert** worden, nicht aus Dokumentation abgeschrieben. Sie dürfen unverändert übernommen werden.

---

## 1. Ziel

Das Dashboard endet heute beim vereinbarten Termin. Was danach passiert — Setter Call, Closer Call, Abschluss, Neukunde — wird bereits importiert, aber nicht ausgewertet und nicht angezeigt. Dieser Auftrag schließt die Kette.

Kern der Aufgabe ist nicht das Anzeigen weiterer Zahlen, sondern **eine Conversion-Kette, die nicht lügt**. Siehe Abschnitt 4.1: Die heutige Abschlussquote ist systematisch zu niedrig.

---

## 2. Faktenlage in Close

### 2.1 Die Kette nach dem Termin

| Stufe | Aktivitätstyp | ID |
|---|---|---|
| Setter Call | `3.✅ Setter Call` | `actitype_7iu5gw2AEBDGBHD7Mqcz3S` |
| Closer Call | `4.⭐️ Closer Call` | `actitype_3kZhgp3iCjGQBHQdilV1Og` |
| No Show | `5.🔄 No Show` | `actitype_6dnbcILqqeo0iGpRCEjOas` |

Abschluss als Opportunity in Pipeline `Sales` (`pipe_42eLhfS7p2vd5Fjw2ou2Sw`), gewonnen bei Status `Kunde` (`stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL`) oder `Upsell/Verlängerung` (`stat_JogyhmNFRLb0ucUfEXPYRJTpVeRXJFix9GB0aVoBfz0`).

### 2.2 Ergebnisfelder mit vollständigen Auswahlwerten

**Ergebnis Setter Call** — `cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo`, Einfachauswahl

```
✅ Closer terminiert
❌ Disqualifiziert
🔎 Setter Follow Up
```

**Ergebnis Closer Call** — `cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn`, Einfachauswahl, Pflichtfeld

```
1. ✅ Verkauft - in CC1
2. 🔥 CC2 vereinbart
3. ✅ Verkauft - in CC2 🔥
4. ❌ Nicht verkauft
```

**Warum nicht durchgesettet?** — `cf_TMufLvpkk5ou17wpdX8B5z4Z2fnH5HeHba1IScAEMsL`, **Mehrfachauswahl**, 15 Werte

```
andere Wege/Lösung im Fokus  (Google, Messe, Headhunter usw.)
Budget
Falsche Zielgruppe
Falscher Ansprechpartner
Haben schon einen Partner
Interne Rücksprache
Kein Bedarf
Marktlage
Nicht an Prozess gehalten
Provision
Reingezogen
Schwammige aussagen
Startdatum zu weit in der Zukunft
Zu klein
Zu skeptisch/ Vertrauen fehlt
```

Der Wert „andere Wege/Lösung im Fokus" enthält **zwei aufeinanderfolgende Leerzeichen** vor der Klammer. Beim Vergleich exakt übernehmen.

**Weitere verwertbare Felder**

| Feld | ID | Typ |
|---|---|---|
| Warum hat er nicht gekauft? | `cf_XJVxLXRNN0eCbDaIh5rC5agDrXh9XDvkb3NP4PUjIff` | Freitext |
| Was können wir verbessern? | `cf_DwxO6QNPPeOsqjtD6N6SSlADt4eHWaBwLlTsI7jUPmC` | Freitext |
| Produkt (Umsatz eintragen) | `cf_wd3EV6WueQe7E00IZ2mC0888HHYJV3584CHocuPNag4` | Freitext, z. B. „8-12K D4Y" |
| Setter No Show | `cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz` | Auswahl |
| Closer No Show | `cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q` | Auswahl |

### 2.3 Was bereits importiert wird

`close-mapping.ts` kennt alle drei Aktivitätstypen und beide Ergebnisfelder. In `daily_sales_metrics` existieren und füllen sich: `setter_calls`, `setter_successes`, `closer_calls`, `closer_sales`, `no_shows`, `cancellations`, `rescheduled_appointments`.

**Es ist also kein Neuaufbau, sondern eine Ergänzung.**

---

## 3. Aufgaben

### 3.1 CC2 als eigene Stufe erfassen

`2. 🔥 CC2 vereinbart` wird heute als Closer Call ohne Verkauf gezählt. Neue Kennzahl `closer_second_calls` in `close_activity_facts` und `daily_sales_metrics`, Aggregation in `recalculate_daily_sales_metrics` und Ausgabe in `get_dashboard_metrics`.

### 3.2 Ablehnungsgründe auswertbar machen

Mehrfachauswahl: Eine Aktivität kann mehrere Gründe tragen. Ein einzelnes Textfeld genügt nicht.

**Empfehlung:** eigene Tabelle `close_rejection_reasons` mit `source_activity_id`, `close_user_id`, `metric_date`, `stage` (`setter` oder `closer`) und `reason`. Eine Zeile je Grund. Dazu eine Funktion `get_rejection_reasons(p_period, p_reference_date)`, die je Grund zählt und absteigend sortiert. Aufbewahrung wie überall: aktueller Monat plus zwei Vormonate, Aufnahme in `cleanup_dashboard_history`.

### 3.3 Frontend

Neuer Abschnitt mit eigener Widget-Kennung (`?widget=closing`), analog zu den bestehenden. Inhalt siehe Akzeptanzkriterien.

### 3.4 Neu importieren

Nach der Mapping-Änderung `MAPPING_VERSION` erhöhen und den vorhandenen Zeitraum ab 2026-08-21 neu importieren. Die Upserts überschreiben sauber, es entstehen keine Duplikate.

---

## 4. Fachliche Regeln

### 4.1 Die Abschlussquote ist heute falsch

`2. 🔥 CC2 vereinbart` ist **weder Verkauf noch Verlust**, sondern Fortsetzung. Sie heute als Closer Call ohne Verkauf zu zählen senkt die Quote systematisch.

Verbindlich:

```
Closer-Abschlussquote = (Verkauft CC1 + Verkauft CC2) ÷ (Closer Calls − CC2 vereinbart)
```

Ein Termin, der in ein zweites Gespräch mündet, verlässt den Nenner, bis er entschieden ist. Wer stattdessen einfach durch alle Closer Calls teilt, misst die Geduld des Prozesses, nicht die Leistung des Closers.

### 4.2 Erwarteter Umsatz bleibt außen vor

Das Feld „Produkt (Umsatz eintragen)" ist Freitext ohne Konvention („8-12K D4Y"). **Nicht parsen.** Eine geratene Zahl ist schlechter als keine. Wenn er ausgewertet werden soll, braucht es vorher ein strukturiertes Feld in Close — das ist eine Absprache mit dem Vertrieb, keine Programmieraufgabe.

### 4.3 Freitextfelder gehören nicht ins Dashboard

„Warum hat er nicht gekauft?" und „Was können wir verbessern?" enthalten Kundennamen und Gesprächsinhalte. Sie sind personenbezogen und dürfen weder in Actions-Logs noch in eine öffentlich erreichbare Oberfläche. Nur die **strukturierten** Gründe aus 2.2 auswerten.

---

## 5. Vor der Umsetzung klären

Drei Punkte, die die Darstellung bestimmen und nicht geraten werden dürfen:

1. **Trichter oder Kennzahlen?** Durchgehende Kette Termin → Setter → Closer terminiert → CC1 → CC2 → Verkauft — oder je Stufe nur Anzahl und Quote?
2. **Ablehnungsgründe als Ranking?** Wenn ja: über welchen Zeitraum, und je Person oder nur im Team?
3. **Wer sieht es?** Am 2026-09-03 wurde volle Transparenz beschlossen und der getrennte Führungsbereich zurückgebaut. Ein eigener Bereich nur für Antony widerspräche dem. Alternative: in der Ziele-Ansicht, die ohnehin nur Manager und Operator sehen.

---

## 6. Akzeptanzkriterien

- [ ] `closer_second_calls` wird importiert, aggregiert und zurückgegeben
- [ ] Abschlussquote nach der Formel aus 4.1, CC2 aus dem Nenner
- [ ] Ablehnungsgründe je Grund zählbar, Mehrfachauswahl korrekt aufgelöst
- [ ] Kein Freitextfeld verlässt die Datenbank Richtung Oberfläche oder Log
- [ ] `MAPPING_VERSION` erhöht, `docs/close-mapping.md` fortgeschrieben
- [ ] Zeitraum ab 2026-08-21 neu importiert
- [ ] Neue Tabellen in `cleanup_dashboard_history` aufgenommen
- [ ] Cache-Kennung `?v=` in `index.html`, `app.js` und `data.js` erhöht
- [ ] Neuer Abschnitt läuft einzeln unter `?widget=closing`
- [ ] `?preview=1` läuft fehlerfrei durch — siehe 7.2

---

## 7. Fallstricke

### 7.1 Aus dem bisherigen Verlauf

- **Auswahlwerte exakt vergleichen.** Emoji, Nummernpräfix und doppelte Leerzeichen gehören zum Wert. Vor jeder Mapping-Änderung Abfrage 7 aus `docs/verification-queries.sql` laufen lassen.
- **Rechte sind nicht Policies.** Eine neue Tabelle braucht **beides**: eine RLS-Policy und ein `GRANT` für `authenticated`. Zweimal ist genau das vergessen worden.
- **`create or replace` überträgt `security definer` nicht.** Wer eine bestehende Funktion neu schreibt, muss die Klausel wiederholen.
- **Cache-Kennung erhöhen.** Dreimal in zwei Tagen übersehen. Nach dem Deploy prüfen:
  `curl -s https://socailprofit.github.io/vertriebsdashboard/ | grep -o 'v=[0-9-]*[a-z]'`

### 7.2 Zielfreie Kennzahlen

Eine Kennzahl ohne Ziel in die Kernwerte zu heben hat am 2026-09-03 das gesamte Dashboard lahmgelegt: `renderCore` schlug Ziele direkt über `metric.target` nach, bekam `undefined` und brach ab. Behoben, aber die Lehre bleibt: **nach jeder Verschiebung einer Kennzahl `?preview=1` aufrufen.** Die Vorschau durchläuft denselben Code-Pfad ohne Anmeldung und zeigt solche Abbrüche sofort.

---

## 8. Verifikation

1. `node --test tests/close-mapping.test.ts` — bestehende Tests grün, neue für CC2 und Ablehnungsgründe ergänzt
2. Push nach `main`, Check „Supabase Preview" muss `success` zeigen
3. Import über `close-sync-write.yml`, höchstens sieben Tage je Lauf
4. Im SQL Editor gegenrechnen: Summe der Closer-Ergebnisse gegen `closer_calls`, Summe der Ablehnungsgründe gegen die Anzahl disqualifizierter Setter Calls
5. `?preview=1` und `?widget=closing` einzeln aufrufen
6. Angemeldet prüfen, dass keine Freitextinhalte im Netzwerkverkehr erscheinen

---

## 9. Quellen

`CODEX_HANDOFF.md` — Stand, Entscheidungen, Einstellungen · `docs/close-mapping.md` — fachliche Regeln · `docs/verification-queries.sql` — Prüfabfragen · `supabase/functions/_shared/close-mapping.ts` — verbindliche IDs

**Close wird ausschließlich gelesen.** Genau ein `fetch` ohne `method`, also GET. Keine Änderung an CRM-Daten, unter keinen Umständen.
