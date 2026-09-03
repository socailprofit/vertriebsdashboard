# Codex Handoff — Social Profit Vertriebsdashboard

## Current Truth

- Die Kette **Close → Supabase Edge Function → Supabase Postgres → Dashboard** läuft vollständig und ist verifiziert.
- Der Sync läuft **alle 15 Minuten** automatisch (`.github/workflows/close-sync-scheduled.yml`) und holt gestern und heute nach.
- In Supabase liegen die letzten 14 Tage (ab 2026-08-21). Aufbewahrung: aktueller Monat plus zwei Vormonate, älteres räumt `cleanup_dashboard_history` weg.
- Das Frontend liest ausschließlich aus Supabase, mit Anmeldung, Rollen und Live-Aktualisierung über Supabase Realtime.
- **Das Mapping ist gegen die realen Close-Werte geprüft** (2026-09-03): Feld-IDs, Gatekeeper-Werte und `4: ✅ Termin vereinbart` stimmen exakt. Fünf Kennzahlen wurden gegen die Rohdaten gegengerechnet und stimmten alle.

## Deine Aufgaben, in dieser Reihenfolge

### 1. Newsletter-Quelle in Close finden und einbauen

Die einzige fachlich offene Kennzahl. In den aktiven Custom-Activity-Typen gibt es bisher keine belastbare Quelle, deshalb schreibt der Sync bewusst `null` und die Oberfläche zeigt `—`. **Eine Null wäre eine Behauptung, keine Messung** — deshalb bitte nicht einfach auf 0 setzen.

Zu tun:

1. In Close identifizieren, wo eine Newsletter-Anmeldung landet: eigener Custom-Activity-Typ, Feld in einem bestehenden Protokoll, Lead-Feld oder Outcome.
2. `supabase/functions/_shared/close-mapping.ts` ergänzen — ID in `CUSTOM_FIELDS` bzw. `ACTIVITY_TYPES`, Auswertung in `mapCustomActivity`.
3. `MAPPING_VERSION` erhöhen (Format `JJJJ-MM-TT.vN`).
4. `docs/close-mapping.md` fortschreiben.
5. Zeitraum neu importieren — die Upserts überschreiben sauber, es entstehen keine Duplikate.
6. `newsletters` aus `metricDefinitions` in `app.js` bekommt dann ein Ziel und wandert bei Bedarf zu den Kernwerten.

**Vor jeder Mapping-Änderung**: Abfrage 7 aus `docs/verification-queries.sql` laufen lassen. Sie zeigt, welche Auswahlwerte Close tatsächlich liefert. Nur so lässt sich prüfen, ob ein Wert exakt getroffen wird.

### 2. Prüfen und optimieren

- Die Ziele in `sales_targets` sind leer. Solange dort nichts steht, zeigen alle Kacheln „kein Ziel hinterlegt" und bleiben farblos. Das ist gewollt — Farben ohne Zielwerte wären geraten — aber der Wettbewerbscharakter fehlt, bis Antony Werte pflegt. Zieleditor: Ansicht „Ziele", Rolle `manager` oder `operator`.
- Alle vier Konten teilen sich derzeit ein Passwort. Das gehört geändert; ein gemeinsames Passwort hebelt die Rollentrennung aus.
- Umsatz, Deals und Abschlussquote werden **weiterhin importiert, aber nicht angezeigt** (Entscheidung vom 2026-09-03). Sie stehen in `daily_sales_metrics` und `get_dashboard_metrics` bereit; im Frontend fehlen sie in `metricDefinitions`. Ungeprüft sind sie ohnehin: Im importierten Zeitraum gab es keinen gewonnenen Deal, und die Frage Vertragswert / MRR / ARR bei `monthly` oder `annual` ist offen.
- Ziele skalieren nach **Arbeitstagen**, nicht Kalendertagen (`workdaysBetween` in `app.js`). Ein Ziel wird für seinen eigenen Zeitraum gepflegt und anteilig auf die Ansicht umgerechnet: 19.800 Brutto-Anrufe für ein Halbjahr ergeben 150 an einem Arbeitstag. Ein Zeitraum ohne Arbeitstage liefert **kein** Ziel statt eines Ziels von null.
- Echte Sekundenaktualität wäre über **Close-Webhooks** erreichbar statt über den Zeitplan. GitHub Actions garantiert keine Pünktlichkeit; 15 Minuten sind das praktisch Dichteste. Ein Webhook, der die Edge Function direkt anstößt, brächte die Latenz auf Sekunden.

### 3. Über GitHub Pages veröffentlichen

Das Repository bleibt öffentlich, der Zugang zum Dashboard hängt an der Anmeldung. Pages liefert nur `index.html`, `styles.css`, `app.js`, `data.js` und `config.js` aus — ohne gültige Sitzung liefert jede Datenabfrage leer, dafür sorgen die RLS-Policies.

Zu beachten:

- `SUPABASE_URL` und die Redirect-URLs in **Authentication → URL Configuration** müssen die Pages-Domain enthalten, sonst schlägt die Anmeldung dort fehl.
- Die Versionskennung an den Datei-Verweisen erhöhen (siehe unten), sonst sehen Besucher nach dem Deploy die alte Version.

## Fallstricke, die bereits Zeit gekostet haben

Diese sechs Punkte haben am 2026-09-02 und 03 jeweils Stunden gekostet. Sie stehen hier, damit sie niemand erneut sucht.

**Supabase-Secret-Namen.** Ein Name mit Leerzeichen (`Close API Key`) wird gespeichert und im Dashboard angezeigt, aber die Edge-Runtime reicht ihn **nicht** als Umgebungsvariable durch. Namen sind zusätzlich case-sensitiv. Der Key heißt heute `Close_API_Key`; die Function liest `CLOSE_API_KEY`, ersatzweise `Close_API_Key`.

**Policies und Tabellenrechte sind zwei Schichten.** Beide Male, als etwas nicht funktionierte, fehlte ein `GRANT`, nicht eine Policy. Erst beim Schreibimport (`permission denied for table sync_runs`), dann bei der ersten Anmeldung (`permission denied for table profiles`). Eine Policy entscheidet, **welche Zeilen** jemand sieht; ob er die Tabelle überhaupt anfassen darf, entscheidet ein Grant davor.

**Close-API, drei Eigenheiten.**
- `custom_activity_type_id` als Filter verlangt zwingend ein einzelnes `lead_id`. Für einen Tagesabzug über alle Leads unbrauchbar — die Typauswahl passiert deshalb beim Mapping, nicht beim Abruf.
- `/activity/call/` und `/activity/custom/` sortieren fest nach `date_created` und kennen kein `_order_by`. Ein `activity_at`-Filter wird mit `400` abgelehnt.
- Folglich ruft der Sync nach **Erstellungszeit** ab, mit zwei Tagen Puffer vor und nach dem Zeitraum, und bestimmt den Berichtstag anschließend selbst über `activity_at`. Die fachliche Regel bleibt: Eine Kennzahl zählt am Tag des Gesprächs.

**Browser-Cache.** Alle Datei-Verweise tragen `?v=…` — in `index.html` sowie an den Importen in `app.js` und `data.js`. **Bei jeder Veröffentlichung erhöhen.** Ein zwischengespeichertes Stylesheet ließ die Gauges als schwarze Flächen erscheinen, und eine zwischengespeicherte `app.js` führte minutenlang zu falschen Schlussfolgerungen.

**Stille Fehler im Frontend.** `startSession()` wurde aus dem Auth-Callback ohne Fehlerbehandlung aufgerufen. Die Anmeldung gelang, danach passierte nichts, und niemand erfuhr warum. Jede Zusage, die aus einem Callback heraus läuft, braucht ein `catch`.

**Aggregierte Fehler statt des ersten.** `Promise.all` meldet nur die zuerst abgelehnte Zusage. Dadurch blieb monatelang verborgen, dass `/activity/call/` genauso scheiterte wie `/activity/custom/`. Die Function sammelt Fehlschläge heute mit `settle()` und meldet alle betroffenen Pfade zusammen.

## Sicherheitsgrenzen

- **Close wird ausschließlich gelesen.** Genau ein `fetch` Richtung Close, ohne `method`, also GET. Kein POST, PUT, PATCH oder DELETE. Gelöscht wird nur in unseren eigenen Supabase-Tabellen durch `cleanup_dashboard_history`, Stichtag ist der aktuelle Monat minus zwei.
- Der **Publishable Key** gehört in `config.js` und damit ins öffentliche Repository. Der **Secret Key** (`sb_secret_…`) und der Legacy `service_role`-Key niemals.
- Die Legacy-API-Keys müssen aktiv bleiben: Die Edge Function meldet sich mit `SUPABASE_SERVICE_ROLE_KEY` an.
- `CLOSE_SYNC_SECRET` muss in GitHub und Supabase **identisch** sein. Beide Seiten sind nicht auslesbar — bei Zweifel beide neu setzen, nicht raten.
- Keine personenbezogenen Zahlen in Actions-Logs. Alle drei Workflows geben nur unpersonalisierte Summen aus. Das Repository ist öffentlich, die Logs sind es damit auch.

## Rollen

| Rolle | Sieht |
|---|---|
| `sales` | Team, Michael, Felix — alle Kennzahlen inklusive Umsatz |
| `manager` | zusätzlich den Zieleditor |
| `operator` | zusätzlich den Sync-Status |

Volle Transparenz ist eine bewusste Entscheidung des Teams vom 2026-09-03: Alle sehen dieselben Zahlen. Der Unterschied liegt nur darin, wer Ziele setzt und wer den Betriebszustand sieht.

## Verbindliche Quellen

1. `docs/close-mapping.md` — fachliche Regeln, Quellen, offene Punkte
2. `supabase/functions/_shared/close-mapping.ts` — ausführbare IDs und Regeln
3. `supabase/functions/close-sync/index.ts` — Abruf, Fenster, Aggregation, Schutz
4. `supabase/migrations/` — Tabellen, RLS, Rechte, Kennzahlenfunktionen, Cleanup
5. `docs/verification-queries.sql` — Prüfabfragen für jeden Import
6. `CLAUDE_CODE_HANDOFF.md` — Vorgeschichte und Entscheidungen

## Zugänge

| Komponente | Wert |
|---|---|
| Repository | `socailprofit/vertriebsdashboard`, Branch `main`, öffentlich |
| Supabase | Projekt `pdobcvffnzqxtmkkpfnn` |
| Edge Function | `https://pdobcvffnzqxtmkkpfnn.supabase.co/functions/v1/close-sync` |
| Workflows | `close-sync-test` (dry-run), `close-sync-write` (manuell), `close-sync-scheduled` (alle 15 Minuten) |
| Designvorschau | `?preview=1` zeigt die Oberfläche mit Beispielzahlen ohne Anmeldung |
| Widgets | `?widget=kernwerte\|verlauf\|trichter\|stunden\|details\|trend` |

Supabase spielt Migrationen bei jedem Push nach `main` selbst ein. Der Check heißt „Supabase Preview" und muss auf `success` stehen, bevor etwas als erledigt gilt. Schlägt er mit `failed to bundle function` fehl, ist das erfahrungsgemäß transient — erneut pushen.
