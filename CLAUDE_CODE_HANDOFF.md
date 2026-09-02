# Claude Code Handoff — Social Profit Vertriebsdashboard

## Current Truth

- GitHub, Supabase und die serverseitige Close-Sync-Function sind verbunden; der Live-Healthcheck ist erfolgreich.
- `CLOSE_SYNC_SECRET` ist in GitHub und Supabase hinterlegt und stimmt seit 2026-09-02 auf beiden Seiten überein. Der Close-API-Key wird aus dem Supabase-Secret `Close_API_Key` gelesen.
- Der manuelle `dry-run` über den GitHub-Workflow ist am 2026-09-02 erfolgreich gelaufen (Run `33638744316`, Zeitraum 2026-09-01): `ok: true`, `mode: dry-run`, `wroteData: false`, 32 Calls und 13 Custom Activities im Berichtsfenster, 45 gemappte Aktivitäten, 2 Personen. Noch wurden keine Close-Daten nach Supabase geschrieben.
- Der begrenzte Ein-Tages-Schreibimport für 2026-09-01 ist am 2026-09-02 erfolgreich gelaufen (Workflow `Close sync write`, Run `33640131990`, `syncRunId` `e8e8302c-04b8-4800-aa70-1a55294e4252`): `wroteData: true`, dieselben Zahlen wie im Dry Run.
- Der nächste Schritt ist der manuelle Abgleich dieser Daten gegen Close. Die Abfragen dafür stehen in `docs/verification-queries.sql`. Vorher wird **kein** stündlicher Zeitplan aktiviert.
- Das UI ist ein funktionierender statischer Prototyp mit Demo-Daten; eine produktive Frontend-Anbindung existiert noch nicht.

## Missing Context

- Definition/Quelle der Newsletter-KPI.
- Behandlung von `monthly`/`annual` Opportunity-Werten (Vertragswert, MRR oder ARR).
- Die drei finalen Supabase-Auth-Konten und die Zuordnung zu Michael, Felix und Antony.
- Auswahl der wichtigsten vier bis sechs KPIs für die kompakte Drei-Monats-Trendansicht.

## Sources

- Laufender Code und fachliches Mapping im GitHub-Repository `socailprofit/vertriebsdashboard`.
- Live-Supabase-Projekt `pdobcvffnzqxtmkkpfnn`.
- Read-only in Close bestätigte Benutzer, Pipelines, Custom Activities und Felder.
- Konkrete Dateipfade, IDs und Prüfkommandos stehen weiter unten in diesem Dokument.

## Timeline

1. ~~Dry Run ausführen und Ergebnis prüfen.~~ Am 2026-09-02 erledigt.
2. ~~Nach ausdrücklicher Freigabe einen begrenzten Ein-Tages-Import schreiben~~ am 2026-09-02 erledigt; der Abgleich gegen Close steht noch aus.
3. Frontend von Demo- auf Supabase-Daten umstellen.
4. Auth/Rollen fertigstellen, danach stündliche Automation und GitHub Pages aktivieren.

## Auftrag und Arbeitsentscheidung

Du übernimmst ein internes, cloudbasiertes Vertriebsdashboard für **Michael Giesbrecht**, **Felix Wenk** und **Antony Rigone**. Es gibt eine gemeinsame Competition-Ansicht und eine Chefansicht; alle drei sehen Michael vs. Felix, Antony verwaltet später Ziele und Einstellungen.

**Arbeitsreihenfolge ist verbindlich:**

1. Zuerst den vorhandenen **schreibfreien End-to-End-Sync-Test** ausführen und auswerten.
2. Erst nach einem erfolgreichen Dry Run einen **manuell bestätigten, begrenzten Schreibimport** ausführen und die Kennzahlen gegen Close prüfen.
3. Erst danach das Frontend von Demo-Daten auf Supabase umstellen und produktionsreif machen.

Begründung: Das Dashboard soll auf überprüften Close-Daten und validiertem Mapping basieren. Baue keine produktive Datenanzeige auf Annahmen oder den Demo-Werten auf.

## Ziele des Produkts

- Eine Webapp, keine drei getrennten Dashboards und kein dauerhaft laufender lokaler Prozess.
- Michael und Felix können ihre persönlichen Werte und den gemeinsamen Wettbewerb sehen.
- Antony sieht zusätzlich Ziele, Sync-Status, Trends und später eine tägliche KI-Zusammenfassung.
- Cloud-Datenfluss: `Close CRM → Supabase Edge Function → Supabase Postgres → Dashboard`.
- GitHub Actions löst später stündlich die bereits in Supabase laufende Sync-Funktion aus. Die Webseite wird **nicht** stündlich neu gebaut.
- KI ist ausdrücklich **nicht** für KPI-Berechnungen zuständig. Sie ist optional nur für eine kurze tägliche Chef-Zusammenfassung aus bereits aggregierten Kennzahlen.

## Zugänge und aktueller Live-Status

| Komponente | Status |
| --- | --- |
| Lokaler Projektordner | `/Users/marclupke2/Documents/Codex/2026-08-25/sc/work/vertriebsdashboard` |
| GitHub Repository | `https://github.com/socailprofit/vertriebsdashboard` |
| Branch | `main` |
| Letzter Commit | `e3572d7 Add protected Close sync dry run` |
| GitHub Repo | öffentlich; **niemals Secrets committen** |
| GitHub CLI | angemeldet als `socailprofit`, Scope `workflow` vorhanden |
| Supabase Projekt-Ref | `pdobcvffnzqxtmkkpfnn` |
| Supabase Dashboard | `https://supabase.com/dashboard/project/pdobcvffnzqxtmkkpfnn` |
| Live Function | `https://pdobcvffnzqxtmkkpfnn.supabase.co/functions/v1/close-sync` |
| Supabase-GitHub-Integration | verbunden mit `socailprofit/vertriebsdashboard`, Arbeitsverzeichnis `.`, Produktion auf `main` |
| GitHub Workflow | `Close sync test` / ID `348396189`, manuell startbar |
| GitHub Secret | `CLOSE_SYNC_SECRET` ist gesetzt (Wert nie ausgeben oder überschreiben) |
| Supabase Secrets | `Close_API_Key` und `CLOSE_SYNC_SECRET` werden von der Function gelesen. Das ältere `Close API Key` ist gespeichert, aber für die Edge-Runtime unlesbar |

Der Screenshot vom 2026-09-02 zeigt beide Supabase-Secrets. Werte sind absichtlich nicht auslesbar. Der aktuelle `CLOSE_SYNC_SECRET` wurde zuletzt sowohl in GitHub als auch in Supabase hinterlegt und muss übereinstimmen.

## Bereits verifiziert

- Mapping-Tests lokal: **5/5 bestanden** mit `node --test tests/close-mapping.test.ts`.
- GitHub Push und Supabase-Integration: erfolgreich.
- Live-Function-Healthcheck: erfolgreiches `GET` liefert `manual-test-ready` und Mapping-Version `2026-09-02.v1`.
- Vollständiger Dry Run über GitHub Actions: GitHub Secret → Supabase Function → Supabase Secret → Close API → Mapping nachweislich durchgängig.
- Abrufregeln gegen die Close-Doku geprüft: Die Typ-Endpunkte sortieren fest nach `date_created`, kennen kein `_order_by` und lehnen `activity_at`-Filter ab; `custom_activity_type_id` erfordert ein einzelnes `lead_id`. Der Sync ruft deshalb nach Erstellungszeit mit zwei Tagen Puffer ab und bestimmt den Berichtstag selbst über `activity_at`. Details in `docs/close-mapping.md`.
- Ungeschützter `POST` auf die Function liefert korrekt `401 unauthorized`.
- Close per MCP read-only geprüft: aktive Benutzer, Custom Activities und Pipelines stimmen mit dem Mapping überein.
- Die relevanten Close-Nutzer sind Michael, Felix und Antony. Die Nutzer-IDs und Activity-/Field-IDs liegen im versionierten Mapping; niemals neu raten.

## Unmittelbare Aufgabe: echter Dry Run

Führe **jetzt** den bestehenden GitHub-Workflow für einen einzelnen Tag aus, zuerst zum Beispiel `2026-09-01`:

```bash
gh workflow run "Close sync test" \
  --repo socailprofit/vertriebsdashboard \
  -f start_date=2026-09-01 \
  -f end_date=2026-09-01

gh run list --repo socailprofit/vertriebsdashboard --workflow "Close sync test" --limit 3
gh run view <RUN_ID> --repo socailprofit/vertriebsdashboard --log-failed
```

Erfolgskriterien im JSON-Output:

- `ok: true`
- `mode: "dry-run"`
- `wroteData: false`
- sinnvolle Werte unter `fetched`, `mapped` und `people`
- keine 401-, 500- oder Mapping-Fehler

Der Dry Run schreibt **keine** CRM- oder Supabase-Daten. Er beweist aber vollständig: GitHub Action → GitHub Secret → Supabase Function → Supabase Secret → Close API → Mapping.

Bei einem Fehler:

1. Zuerst nur Logs und Funktionslogs prüfen.
2. Keine Secrets in Logs, Issues oder Commits schreiben.
3. Prüfen, ob `CLOSE_SYNC_SECRET` in GitHub und Supabase derselbe Wert ist.
4. Prüfen, ob das Supabase-Secret `CLOSE_API_KEY` oder `Close_API_Key` heißt. Namen mit Leerzeichen erreichen die Function nie; nicht ungefragt einen neuen Close-Key erzeugen.
5. Keine Close-Datensätze verändern.

## Erst nach erfolgreichem Dry Run: kontrollierter Import

Der Code unterstützt `mode: "write"`, aber ein Schreibimport muss vor dem Start explizit vom Nutzer bestätigt werden. Dafür entweder einen separaten manuellen Workflow `close-sync-write.yml` anlegen oder den bestehenden Workflow um ein sicheres, ausdrückliches `mode`- und `confirm_write`-Gate erweitern.

Der erste Schreibimport darf nur **einen klar definierten Testtag** umfassen. Danach manuell gegen Close prüfen:

- Anzahl Brutto-/Netto-Calls pro Michael/Felix
- Durchstellungen und Entscheiderkontakte
- Termine und Terminquote
- gewonnene Deals und Umsatzzuordnung
- Sync-Run-Status, Rohdaten, Facts und `daily_sales_metrics`
- Drei-Monats-Aufbewahrung / Cleanup erst nach Sichtprüfung bestätigen

Erst wenn diese Daten plausibel sind, den stündlichen Zeitplan aktivieren. Kein Schedule vor dem manuellen Datenvergleich.

## Danach: Frontend produktiv anbinden

Der sichtbare Prototyp existiert bereits, nutzt aber nur Demo-Daten:

- `index.html`
- `styles.css`
- `app.js`

Aktuell stammen Kennzahlen aus `demoData` und Ziele aus lokalem `state`. Der nächste Frontend-Schritt ist daher **nicht** ein Redesign, sondern:

1. Supabase Client sicher einbinden (nur Publishable Key, niemals Service Role).
2. Demo-Daten durch Abfragen von serverseitig geschützten Tabellen/Views ersetzen.
3. Auth und Row Level Security mit echten drei Benutzerkonten vervollständigen.
4. Chefansicht: Ziele in `sales_targets` speichern; nur Manager darf schreiben.
5. Sync-Status und Zeitstempel im UI zeigen.
6. Filter für Tag, Woche, Monat sowie eine kompakte Trendsicht für aktueller Monat + zwei Vormonate implementieren.
7. Erst dann GitHub Pages als statisches Hosting konfigurieren und veröffentlichen.

### MVP-KPIs, die sichtbar sein müssen

- Anrufe brutto und netto
- Gesprächszeit
- Vorzimmer/Gatekeeper-Kontakte
- Durchstellungen
- direkte und gesamte Entscheiderkontakte
- Termine und Terminquote
- Setter-/Closer-Calls und Erfolge
- No-Shows, Absagen, Verschiebungen
- Deals und Umsatz werden importiert, aber vorerst **nicht angezeigt** (am 2026-09-02 entschieden)
- beste Anrufzeiten: Nettoquote **und** Durchstellquote nach Uhrzeit (am 2026-09-02 entschieden; die Datenbankfunktion liefert beide)
- Michael-vs.-Felix-Rangliste und Zielerreichung
- Newsletter bleibt `null`, bis eine echte Close-Quelle feststeht

Die Plecto-ähnliche Competition-Optik ist bereits als statischer Prototyp vorhanden. Behalte Michael blau und Felix orange. Leistungsfarben sollen später anhand zentral gepflegter Ziele funktionieren.

## Datenmodell und Mapping: verbindliche Quellen

Vor Mapping- oder UI-Änderungen diese Dateien lesen:

1. `docs/close-mapping.md` — fachliche Mapping-Regeln, Quellen und offene Punkte.
2. `supabase/functions/_shared/close-mapping.ts` — ausführbare, verbindliche IDs und Regeln.
3. `supabase/functions/close-sync/index.ts` — Pagination, Dry Run/Write, Aggregation und Schutz.
4. `supabase/migrations/20260902090000_dashboard_foundation.sql` — Tabellen, RLS, Rollen, Kennzahlen, Cleanup und Views/Funktionen.
5. `README.md` — Current Truth, Missing Context, Sources und Timeline.

Wichtige Regeln aus dem Mapping:

- Reporting-Zeitzone: `Europe/Berlin`.
- Nur Michael und Felix werden in `TARGET_USER_IDS` verarbeitet.
- Sales Pipeline ist `Sales`; beide gewonnenen Status werden berücksichtigt.
- Umsatz wird dem Lead-Opener zugerechnet. Setter/Closer dienen als Attribution, nicht als Umsatz-Doppelzählung.
- Brutto-Call: finaler ausgehender Call. Netto-Call: abgeschlossener, beantworteter ausgehender Call.
- Termin: nur klar definierte Entscheider-Ergebniswerte.
- Drei-Monats-Fenster: aktueller Monat plus zwei Vormonate. Ältere Rohdaten, Tageswerte, Ziele, Summaries und Sync-Runs werden beim Cleanup entfernt.

## Sicherheitsgrenzen

- Keine API-Keys, Secrets, Tokens oder personenbezogenen CRM-Rohdaten in Git, Frontend, Logs oder Chat ausgeben.
- Der Close-API-Key muss unter einem Namen **ohne Leerzeichen** in Supabase liegen. Die Function liest `CLOSE_API_KEY`, ersatzweise `Close_API_Key`. Das ursprüngliche `Close API Key` wurde am 2026-09-02 als unlesbar nachgewiesen: Die Edge-Runtime kann Umgebungsvariablen mit Leerzeichen im Namen nicht durchreichen, die Function scheiterte reproduzierbar mit `Missing server secret`.
- `CLOSE_SYNC_SECRET` schützt POST-Requests zur Function. Die Function hat `verify_jwt = false`, deshalb ist dieser Header zwingend.
- Nur serverseitige Function schreibt CRM-Importdaten. Normale Dashboard-Nutzer dürfen Rohdaten und Sync-Schreibzugriffe nicht erhalten.
- Öffentliche Login-Seite ist möglich, aber ein Frontend-PIN allein ist kein Zugriffsschutz. Fertigstellung braucht Supabase Auth, RLS, Rollen und echte Sessions.
- Keine stündliche KI-Auswertung. KI, falls überhaupt, nur einmal täglich aus aggregierten Kennzahlen; Kosten und Schlüssel serverseitig halten.

## GitHub Actions und Hosting

Aktuell gibt es nur den manuellen Safe-Workflow:

- `.github/workflows/close-sync-test.yml` — löst ausschließlich `dry-run` aus und prüft `wroteData: false`
- `.github/workflows/close-sync-write.yml` — der einzige manuelle Schreibpfad; verlangt `confirm_write: WRITE` und lehnt Zeiträume über sieben Tage ab
- beide verwenden GitHub Secret `CLOSE_SYNC_SECRET` und halten personenbezogene Zahlen aus dem öffentlichen Actions-Log heraus

Nach validiertem Schreibimport:

1. Einen separaten stündlichen Workflow anlegen, der nur die Supabase Function mit `mode: "write"` aufruft.
2. Er darf das Dashboard nicht neu bauen.
3. Fehler sichtbar machen (Job fehlgeschlagen, optional spätere Manager-Benachrichtigung).
4. GitHub Pages für das statische Frontend einrichten, nachdem es Supabase-Daten sicher liest.

Hostinger wird nicht benötigt. GitHub Pages plus Supabase ist für diesen internen MVP die schlankere Lösung. Keine Geheimnisse im Pages-Frontend.

## Nützliche lokale Befehle

```bash
cd /Users/marclupke2/Documents/Codex/2026-08-25/sc/work/vertriebsdashboard

# Qualität
node --check app.js
node --test tests/close-mapping.test.ts
git diff --check

# GitHub Status
git status --short
gh workflow list --repo socailprofit/vertriebsdashboard --all
gh run list --repo socailprofit/vertriebsdashboard --limit 10

# Lokale statische Vorschau (nur Demo-UI)
python3 -m http.server 4173
```

## Definition of Done für die nächste Phase

Die nächste Phase ist fertig, wenn:

- der manuelle GitHub Dry Run erfolgreich und dokumentiert ist;
- ein vom Nutzer freigegebener Ein-Tages-Write-Import erfolgreich ist;
- Stichproben in Close und Supabase übereinstimmen;
- das Frontend echte, RLS-geschützte Daten statt `demoData` anzeigt;
- Auth/Rollen für Michael, Felix und Antony funktionieren;
- der stündliche Job erst dann aktiviert wird;
- keine Secrets im Git-Verlauf stehen.

## Offene Fachentscheidungen, nicht raten

- Quelle und Definition der Newsletter-Zahl.
- Bei `monthly`/`annual` Opportunities: Vertragswert, MRR oder ARR für die Umsatzanzeige. Vertagt, solange der Umsatz nicht angezeigt wird.
- Genaue Konten/E-Mails für Michael, Felix und Antony in Supabase Auth.
- Welche vier bis sechs KPIs in der kompakten Drei-Monats-Trendansicht besonders prominent sind.

Wenn eine dieser Fragen die Datenberechnung oder Zugriffsrechte verändert, Nutzer fragen, statt eine Annahme produktiv einzubauen.
