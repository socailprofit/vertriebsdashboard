# Antony-Pipeline und Gesamtverlauf

## Current Truth

- `get_antony_open_pipeline(reference_date)` liefert nur aggregierte offene Funnel-Stufen aus dem rollierenden Drei-Monats-Fenster.
- Ein Lead zählt höchstens einmal. Gewonnene Opportunities werden ausgeschlossen.
- Die Zustände werden ausschließlich aus der zeitlichen Reihenfolge bereits gemappter Ereignisse abgeleitet: Termin ohne Setter Call, Closer terminiert, Closer verschoben und CC2/Entscheidung offen.
- Vormonatsfälle und seit mehr als 14 Tagen offene Fälle sind überlappende Prioritätsmarker, keine zusätzlichen Leads.
- `get_antony_performance_series(period, reference_date)` liefert den kumulierten Verlauf für Termine, Closer-Termine, durchgeführte Closer Calls und Neukunden.
- Tag zeigt 08:00–17:00 Uhr in `Europe/Berlin`; Woche zeigt Montag bis Freitag beziehungsweise Stichtag; Monat zeigt Monatserster bis Stichtag.
- Won-Daten sind im bestehenden Mapping nur tagesgenau. Deshalb zeigt der Tagesgraph keine erfundene Neukunden-Uhrzeit, sondern nur die korrekte Tagessumme über dem Graphen.
- Beide Browser-RPCs verlangen eine authentifizierte Sitzung und `has_dashboard_access()`. Tabellen, IDs, Namen, Notizen und Rohpayloads werden nicht freigegeben.
- Der private Helper `get_antony_pipeline_snapshot()` ist nur für `service_role` ausführbar und stellt dem Wochenreview dieselben aggregierten Pipeline-Summen bereit.

## Missing Context

- Aktive Close-Opportunity-Statuswerte werden derzeit nicht synchronisiert. Die Pipeline darf deshalb nicht als vollständige Close-Pipeline oder Forecast einzelner Opportunities bezeichnet werden.
- Wenn später konkrete Opportunity-Stufen benötigt werden, muss der Close-Sync sie ausdrücklich read-only erfassen und in eine separate, RLS-geschützte Faktenstruktur mappen.
- Das exakte Datum eines zukünftigen verschobenen Termins ist nicht Teil der aktuellen Aggregation; erkennbar ist nur, dass nach dem Verschieben noch kein neuer Closer Call erfasst wurde.

## Sources

- `supabase/migrations/20260904160000_add_antony_pipeline_and_performance.sql`
- `supabase/functions/close-sync/index.ts`
- `supabase/functions/_shared/close-mapping.ts`
- `app.js`
- `data.js`

## Timeline

- 2026-09-04: Aggregierte offene Antony-Pipeline, periodengerechter Gesamtverlauf und serverseitige Wochenreview-Anbindung ergänzt.
