# Current Truth

Antony, seine KPIs und die KI sind über `private.antony_permissions` freigegeben. Die Tabelle enthält Auth-User-IDs und ist für Browserrollen weder lesbar noch schreibbar. `has_antony_access()` prüft die Freigabe und den abgeschlossenen persönlichen Passwortwechsel. Der Browser fragt diesen RPC beim Laden des Profils ab. Eine Manager-Rolle allein reicht nicht.

Die bestehenden zwei Leitungskonten wurden aus der vorherigen Freigabe übernommen. Historische SQL-Dateien enthalten jetzt ausdrücklich nicht zustellbare Beispieladressen; bereits angewendete Migrationen werden nicht erneut ausgeführt. Die neue Migration ersetzt die produktive Zugriffsprüfung.

# Missing Context

Ein neu aufgebautes Supabase-Projekt benötigt eine administrative Zuweisung der erlaubten Auth-User-IDs in der privaten Tabelle. Keine echten Kontoadressen oder User-IDs dafür in Git eintragen. Frühere Git-Commits wurden nicht umgeschrieben und können alte E-Mail-Adressen enthalten.

# Sources

- `access-control.mjs`, `data.js`
- `supabase/migrations/20260907091134_private_antony_permissions.sql`
- `supabase/tests/weekly-review-schedule.sql`

# Timeline

- 2026-09-07: E-Mail-Listen im aktuellen Repository durch private, serverseitige Freigaben ersetzt; bestehende Kontofreigaben und Passwortsperren beibehalten.
