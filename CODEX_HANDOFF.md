# Codex Handoff — Social Profit Vertriebsdashboard

Stand 2026-09-03. Diese Datei beschreibt **vollständig**, was seit der Übergabe an Claude Code am 2026-09-02 geschehen ist: jeder Fortschritt, jede Entscheidung, jede Einstellung außerhalb des Repositories — und die eine Frage, die noch offen ist.

Umfang der Arbeit: 40 Commits, 25 geänderte Dateien, +3.147 / −1.256 Zeilen, 11 Migrationen, 3 Workflows.

---

## 1. Ausgangslage

Bei der Übergabe existierten: ein statischer UI-Prototyp mit erfundenen Demo-Zahlen, eine deployte Edge Function, deren Healthcheck antwortete, und ein manuell startbarer Dry-Run-Workflow. **Es war noch nie ein Datensatz aus Close geflossen.** Der erste Dry Run stand aus.

## 2. Was heute läuft

- Die Kette **Close → Edge Function → Postgres → Dashboard** ist vollständig, verifiziert und automatisiert.
- Der Sync läuft **alle 15 Minuten** (`close-sync-scheduled.yml`, Minuten 7, 22, 37, 52) und holt gestern und heute nach.
- In Supabase liegen 14 Tage ab 2026-08-21: **402 Anrufe, 123 Protokolle, 525 Aktivitäten**.
- Das Frontend liest ausschließlich aus Supabase — mit Anmeldung, drei Rollen, Live-Aktualisierung und Ampelfarben gegen gepflegte Ziele.
- **Das Mapping ist gegen die realen Close-Werte geprüft.** Nicht plausibilisiert, sondern gegengerechnet.

## 3. Chronologie

### Phase 1 — Den Dry Run zum Laufen bringen

Fünf Ursachen, jede einzeln gefunden, weil die vorherige sie verdeckte:

1. **`CLOSE_SYNC_SECRET` stimmte nicht überein.** GitHub und Supabase hielten verschiedene Werte. Beide Seiten sind nicht auslesbar — die Lösung war, beide neu auf denselben Wert zu setzen, nicht zu raten.
2. **`Close API Key` war unlesbar.** Supabase speichert einen Secret-Namen mit Leerzeichen und zeigt ihn an, reicht ihn aber **nicht** als Umgebungsvariable durch. Der Key heißt jetzt `Close_API_Key`.
3. **Groß-/Kleinschreibung.** Umgebungsvariablen sind case-sensitiv; `Close_API_Key` ≠ `CLOSE_API_KEY`.
4. **`custom_activity_type_id` verlangt ein einzelnes `lead_id`.** Für einen Tagesabzug über alle Leads unbrauchbar. Die Typauswahl passiert seither beim Mapping, nicht beim Abruf.
5. **`activity_at`-Filter sind unmöglich.** Die Typ-Endpunkte sortieren fest nach `date_created` und kennen kein `_order_by`. Close lehnt den Filter mit `400` ab.

Ursache 5 hätte beinahe still die Tageszuordnung verfälscht. **Entscheidung:** Abruf nach Erstellungszeit mit zwei Tagen Puffer, Berichtstag anschließend selbst über `activity_at` bestimmt. Die fachliche Regel bleibt: Eine Kennzahl zählt am Tag des Gesprächs.

Nebenbei behoben: Der Workflow verschluckte bei Fehlern die Antwort, und er hätte bei Erfolg die Tageszahlen von Michael und Felix in ein **öffentliches** Actions-Log geschrieben.

### Phase 2 — Erster Schreibimport

Scheiterte zunächst mit `42501`: Der Grundmigration fehlten sämtliche Rechte für `service_role` auf den eigenen Tabellen. Danach erfolgreich für 2026-09-01.

Damit ein Fehler künftig sagt, wo er auftrat, gibt die Function seither Kategorien statt `sync_failed` zurück, benennt den Schreibschritt und sammelt mit `settle()` **alle** fehlgeschlagenen Abrufe statt nur des ersten. Genau das deckte auf, dass `/activity/call/` ebenso scheiterte wie `/activity/custom/` — vorher durch `Promise.all` verdeckt.

### Phase 3 — Frontend auf echte Daten

`demoData`, erfundene Stundenwerte und eine Projekttabelle ohne jede Close-Quelle entfernt. Datenschicht, Anmeldung, Rollen, Zieleditor und Realtime verdrahtet.

### Phase 4 — Plecto-Optik

Auf Wunsch an der Plecto-Vorlage ausgerichtet: Bannerzeilen, Kachelraster, Hufeisen-Gauges als SVG, Ampelfarbe auf der Zahl selbst, Leaderboard mit Rangringen.

### Phase 5 — Rollen und Transparenz

Zunächst als getrennter, passwortgeschützter Führungsbereich gebaut. **Am selben Tag im Team verworfen:** volle Transparenz, alle sehen dieselben Zahlen. Der Bereich wurde vollständig zurückgebaut.

Die Umsatzprognose wurde ebenfalls gebaut und wieder verworfen — eine lineare Hochrechnung multiplizierte den Monatsanfang mit sieben und sah nach einer Aussage aus, ohne eine zu sein.

### Phase 6 — Erste Anmeldung

Scheiterte stumm: „Anmeldung läuft" verschwand, dann passierte nichts. Ursache war eine im Auth-Callback verschluckte Fehlermeldung. Nach deren Sichtbarmachung zeigte sich `permission denied for table profiles` — erneut fehlende `GRANT`s, diesmal für `authenticated`.

### Phase 7 — Kompakte Ansicht, Ziele, Automatik

Von 42 Zahlen auf der ersten Ebene auf 12 reduziert, Diagramme statt Kachelfluten, Widget-Modus, Ziele als eigener Streifen, Zeitplan aktiviert.

---

## 4. Alle Entscheidungen

| Datum | Entscheidung | Begründung |
|---|---|---|
| 02.09. | Berichtstag über `activity_at`, Abruf über `date_created` mit 2 Tagen Puffer | Close lässt keinen `activity_at`-Filter zu; die fachliche Regel soll trotzdem gelten |
| 02.09. | Keine personenbezogenen Zahlen in Actions-Logs | Repository ist öffentlich, Logs sind es damit auch |
| 02.09. | Repo-Sichtbarkeit vertagt | betrifft Pages und Log-Datenschutz zugleich |
| 02.09. | Beide Stundenquoten anzeigen | Nettoquote und Durchstellquote beantworten verschiedene Fragen |
| 02.09. | Deals und Umsatz importieren, nicht anzeigen | vertagt die offene MRR/ARR-Frage |
| 02.09. | Zieltabelle erweitert | jede sichtbare Zahl soll ein Ziel bekommen können |
| 02.09. | Realtime für 3 Tabellen | Free-Plan deckt es mit großem Abstand; Rohdaten bewusst nicht abonniert |
| 03.09. | **Volle Transparenz, kein Führungsbereich** | Team-Entscheidung; alle sehen dieselben Zahlen |
| 03.09. | Umsatzprognose verworfen | lineare Hochrechnung sieht aus wie eine Aussage, ist aber keine |
| 03.09. | Deals, Umsatz, Abschlussquote aus der Anzeige | nicht Teil der vereinbarten KPI-Liste |
| 03.09. | Kern-KPIs: **Brutto, Netto, Entscheider, Termine** | Vorgabe |
| 03.09. | Ziele skalieren nach **Arbeitstagen** | „150 am Tag" meint Mo–Fr; durch 30 statt 22 wäre die Vorgabe um ein Drittel zu niedrig |
| 03.09. | Einzelansicht zeigt nur die Person | vorher zeigte jede Ansicht dieselben Zahlen |
| 03.09. | Repository bleibt öffentlich | Pages im Free-Plan; Zugang hängt an der Anmeldung |
| 03.09. | Zeitplan auf Minuten 7/22/37/52 | drei aufeinanderfolgende `*/15`-Läufe fielen aus |

---

## 5. Einstellungen außerhalb des Repositories

**Supabase**

| Bereich | Einstellung |
|---|---|
| Edge-Function-Secrets | `Close_API_Key`, `CLOSE_SYNC_SECRET` |
| Legacy-API-Keys | **müssen aktiv bleiben** — die Function nutzt `SUPABASE_SERVICE_ROLE_KEY` |
| Publishable Key | `sb_publishable_…`, benannt „socialprofit", liegt in `config.js` |
| Realtime | veröffentlicht für `daily_sales_metrics`, `sales_targets`, `sync_runs` |
| Auth | 4 Konten angelegt, alle mit „Auto Confirm" |
| GitHub-Integration | verbunden, spielt Migrationen und Function bei jedem Push nach `main` ein |

**Konten und Rollen** (Tabelle `profiles`)

| E-Mail | Rolle | Person |
|---|---|---|
| `m.giesbrecht@socialprofit.de` | `sales` | michael |
| `f.wenk@socialprofit.de` | `sales` | felix |
| `rigone@socialprofit.de` | `manager` | — |
| `info@socialprofit.de` | `operator` | — |

⚠️ **Alle vier teilen dasselbe Passwort.** Das hebelt die Rollentrennung aus und gehört geändert.

**Ziele** (Tabelle `sales_targets`, Zeitraum 2026-07-01 bis 2026-12-31)

- `calls_gross` = 19.800 — entspricht 150 je Arbeitstag bei 132 Arbeitstagen
- `appointment_rate_target` = 25 %
- alle übrigen Spalten 0 beziehungsweise leer, damit sie bewusst **kein** Ziel haben

**GitHub**

| | |
|---|---|
| Secret | `CLOSE_SYNC_SECRET` |
| Workflows | `close-sync-test` (Dry Run), `close-sync-write` (manuell, max. 7 Tage, `confirm_write: WRITE`), `close-sync-scheduled` (7/22/37/52) |
| Pages | **noch nicht eingerichtet** |

---

## 6. Die offene Entscheidung: Wer taktet den Sync?

Das ist der Punkt, den du mit dem Nutzer klären sollst.

**Beobachtung vom 03.09.:** Der Zeitplan `*/15` hat drei aufeinanderfolgende Läufe (09:15, 09:30, 09:45) **nicht** ausgeführt. GitHub dokumentiert Zeitpläne ausdrücklich als „best effort" und verschiebt sie bei Auslastung; `*/15` trifft genau die vier Minuten, auf die alle Repositories takten. Der Takt wurde deshalb auf 7/22/37/52 verschoben. **Ob das genügt, ist noch nicht belegt** — der erste Lauf danach stand zum Zeitpunkt dieser Übergabe aus.

| Option | Verlässlichkeit | Latenz | Aufwand | Voraussetzung |
|---|---|---|---|---|
| **A. GitHub Actions** (heute) | best effort, Ausfälle belegt | bis 15 Min | keiner | — |
| **B. Supabase pg_cron** | hoch, läuft in der Datenbank | bis 15 Min | ~20 Zeilen Migration | Erweiterungen `pg_cron` + `pg_net` aktivieren, Secret zusätzlich im Vault |
| **C. Close-Webhooks** | ereignisgesteuert | Sekunden | Webhook-Endpunkt in der Function, Registrierung in Close | Webhook in Close anlegen |

**Wichtig:** Bei B und C wird nur `close-sync-scheduled.yml` überflüssig. GitHub bleibt in jedem Fall nötig — für den Code, für das Einspielen von Migrationen und Function, für den manuellen Nachimport, für den schreibfreien Test und für Pages. Der Zeitplan ist eine von fünf Aufgaben und die einzige, die GitHub schlecht erledigt.

**Vorbehalt zu B:** Supabase pausiert Projekte im Free-Plan nach längerer Inaktivität; ein pausiertes Projekt führt keine Cron-Jobs aus. Das trifft A allerdings genauso.

**Empfehlung:** Erst beobachten, ob der verschobene Takt hält. Wenn ja, ist B unnötiger Aufwand. Wenn Ausfälle bleiben, ist B der kleine und C der richtige Schritt.

---

## 7. Deine Aufgaben

### 7.1 Newsletter-Quelle finden und einbauen

Die einzige fachlich offene Kennzahl. In den aktiven Custom-Activity-Typen gibt es keine belastbare Quelle, deshalb schreibt der Sync `null` und die Oberfläche zeigt `—`. **Eine Null wäre eine Behauptung, keine Messung.**

1. In Close identifizieren, wo eine Anmeldung landet: eigener Activity-Typ, Feld in einem Protokoll, Lead-Feld oder Outcome.
2. `supabase/functions/_shared/close-mapping.ts` ergänzen.
3. `MAPPING_VERSION` erhöhen (`JJJJ-MM-TT.vN`).
4. `docs/close-mapping.md` fortschreiben.
5. Zeitraum neu importieren — Upserts überschreiben sauber.
6. In `app.js` bekommt `newsletters` dann ein Ziel und kann zu den Kernwerten wandern.

**Vor jeder Mapping-Änderung** Abfrage 7 aus `docs/verification-queries.sql` laufen lassen. Sie zeigt, welche Auswahlwerte Close tatsächlich liefert — der einzige Weg zu prüfen, ob ein Wert exakt getroffen wird.

### 7.2 Prüfen und optimieren

- **Umsatz ist ungeprüft.** Im importierten Zeitraum gab es keinen gewonnenen Deal. Die Zuordnung über `3.01 Opener` und die Frage Vertragswert / MRR / ARR bei `monthly` oder `annual` sind unbestätigt. Die Daten liegen in `daily_sales_metrics` und `get_dashboard_metrics` bereit; sie fehlen nur in `metricDefinitions`.
- **Passwörter trennen.**
- **Zeitplan-Entscheidung** aus Abschnitt 6.

### 7.3 GitHub Pages einrichten

Repository bleibt öffentlich, Zugang über die Anmeldung. Pages liefert nur die statischen Dateien; ohne gültige Sitzung liefert jede Abfrage leer, dafür sorgen die RLS-Policies.

- **Authentication → URL Configuration** muss die Pages-Domain enthalten, sonst schlägt die Anmeldung dort fehl.
- Versionskennung an den Datei-Verweisen erhöhen.

---

## 8. Fallstricke

Jeder hat Stunden gekostet. Sie stehen als das hier, was passiert ist — nicht als Ratschlag.

**Secret-Namen.** Ein Name mit Leerzeichen wird gespeichert und angezeigt, aber nicht als Umgebungsvariable durchgereicht. Namen sind case-sensitiv.

**Policies ≠ Rechte.** Beide Male, als etwas nicht ging, fehlte ein `GRANT`. Eine Policy entscheidet, **welche Zeilen** jemand sieht; ob er die Tabelle anfassen darf, entscheidet ein Grant davor. Betraf erst `service_role`, dann `authenticated`.

**Close-API.** `custom_activity_type_id` verlangt ein einzelnes `lead_id`. Die Typ-Endpunkte sortieren fest nach `date_created`, kennen kein `_order_by`, und lehnen `activity_at`-Filter mit `400` ab.

**Browser-Cache.** Alle Datei-Verweise tragen `?v=…` in `index.html` sowie an den Importen in `app.js` und `data.js`. **Bei jeder Veröffentlichung erhöhen.** Ein zwischengespeichertes Stylesheet ließ die Gauges als schwarze Flächen erscheinen; eine zwischengespeicherte `app.js` führte minutenlang zu falschen Schlüssen.

**Stille Fehler.** `startSession()` lief aus dem Auth-Callback ohne `catch`. Die Anmeldung gelang, danach passierte nichts, und niemand erfuhr warum.

**Erster statt aller Fehler.** `Promise.all` meldet nur die zuerst abgelehnte Zusage. Dadurch blieb verborgen, dass zwei Endpunkte gleichzeitig scheiterten.

**Doppelte CSS-Regeln.** Eine alte `.funnel`-Regel trug `grid-template-columns` und überlebte ihre Nachfolgerin, die nur `gap` überschrieb — der Trichter stand nebeneinander statt untereinander. Bei Layout-Änderungen den toten Stil mitentfernen.

---

## 9. Sicherheitsgrenzen

- **Close wird ausschließlich gelesen.** Genau ein `fetch` Richtung Close, ohne `method`, also GET. Gelöscht wird nur in unseren eigenen Tabellen durch `cleanup_dashboard_history`, Stichtag aktueller Monat minus zwei.
- Publishable Key gehört ins Repository. Secret Key (`sb_secret_…`) und Legacy `service_role`-Key **niemals**.
- Legacy-API-Keys aktiv lassen — die Function nutzt `SUPABASE_SERVICE_ROLE_KEY`.
- `CLOSE_SYNC_SECRET` muss beidseitig identisch sein. Beide Seiten sind nicht auslesbar; bei Zweifel beide neu setzen.
- Keine personenbezogenen Zahlen in Actions-Logs.
- **Im Frontend steht keine einzige fest eingetragene Kennzahl.** Geprüft am 03.09.: Alle Zahlen kommen über `data.load*` aus Supabase; die einzigen Zahlenliterale außerhalb der Vorschau sind ein Kommentar und ein `setTimeout`. Die Vorschau `?preview=1` ist isoliert und durch einen orangen Balken gekennzeichnet.

---

## 10. Verifikationsnachweise

**Mapping gegen Close, 2026-09-03.** Nicht plausibilisiert, sondern gegengerechnet:

| Wert in Close | Anzahl | Dashboard | |
|---|---|---|---|
| `4: ✅ Termin vereinbart` | 1 | Termine 1 | ✅ |
| `✅ Durchgestellt` | 2 | Durchstellungen 2 | ✅ |
| `🛑 Kein Gatekeeper` | 2 | Entscheider direkt 2 | ✅ |
| Gatekeeper-Werte ≠ „Kein Gatekeeper" | 9 | Vorzimmer 9 | ✅ |
| gesetzte Entscheider-Werte | 4 | Entscheider gesamt 4 | ✅ |

Alle drei geprüften Feld-IDs stimmen mit `CUSTOM_FIELDS` überein.

**Unabhängig davon, 2026-09-02:** Close-Leaderboard für den 01.09. zeigte Michael 25 + Felix 7 = 32; der Import ergab exakt 32 Anrufe im Fenster. Antonys 2 Anrufe blieben korrekt außen vor. Gewonnene Opportunities 0 = 0.

**Realtime:** Kanal auf `daily_sales_metrics` meldet `SUBSCRIBED`. Dass Ereignisse in einer angemeldeten Sitzung tatsächlich ankommen, ist **noch nicht beobachtet** worden.

---

## 11. Dateien

| Datei | Inhalt |
|---|---|
| `docs/close-mapping.md` | fachliche Regeln, Quellen, offene Punkte |
| `docs/verification-queries.sql` | 8 Prüfabfragen, darunter die Mapping-Deckung |
| `supabase/functions/_shared/close-mapping.ts` | IDs und Mapping-Regeln |
| `supabase/functions/close-sync/index.ts` | Abruf, Fenster, Aggregation, Schutz, Fehlerkategorien |
| `supabase/migrations/` | 11 Migrationen |
| `config.js` / `data.js` / `app.js` | Verbindung, Datenschicht, Darstellung |
| `CLAUDE_CODE_HANDOFF.md` | Vorgeschichte |

**Nützlich:** `?preview=1` zeigt die Oberfläche mit Beispielzahlen ohne Anmeldung. `?widget=kernwerte|verlauf|trichter|stunden|details|trend` rendert einen Abschnitt allein, für spätere Einbettung per `<iframe>`.

Supabase spielt Migrationen bei jedem Push nach `main` ein. Der Check heißt „Supabase Preview" und muss auf `success` stehen. Bei `failed to bundle function` erneut pushen — der Fehler war reproduzierbar transient.
