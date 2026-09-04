# Antony-Wochenreview

## Current Truth

- `weekly-review` erzeugt höchstens einen Review je ISO-Kalenderwoche und genau fünf kurze Geschäftsführer-Punkte.
- Der vorgesehene Cron ruft die Function nach dem Deployment montags um 07:10 UTC auf. Sie analysiert die letzte abgeschlossene Vertriebswoche von Montag bis Freitag in `Europe/Berlin`.
- Das Modell erhält ausschließlich die in `get_weekly_review_kpis` gebildeten Summen und Quoten der letzten abgeschlossenen Woche und der Vorwoche sowie die aggregierte offene Pipeline-Momentaufnahme. Mengenänderungen und Prozentpunktänderungen werden vor dem Modellaufruf deterministisch berechnet. Rohpayloads, Close-Freitexte, IDs, Namen und E-Mail-Adressen sind nicht Teil des Modellinputs.
- Die geschäftliche Einordnung stammt aus genau einer aktiven, manuell gepflegten Version in `weekly_review_contexts`. Die Whitelist begrenzt sie auf Unternehmen, Angebot, ICP, Sales Motion, KPI-Definitionen, Prioritäten und Benchmarks.
- Der OpenAI-Aufruf läuft ausschließlich in der Supabase Edge Function mit `store: false`. `OPENAI_API_KEY` ist nur ein Supabase Function Secret.
- Fertige Reviews liegen in `weekly_reviews`; `context_version` dokumentiert die verwendete Business-Profil-Version. Die Unique-Regel auf ISO-Jahr und ISO-Woche sowie eine Reservierung vor dem API-Aufruf verhindern doppelte Reviews.
- Ausschließlich die vollständig eingerichteten Konten `rigone@socialprofit.de` und `info@socialprofit.de` können den fertigen Reviewtext über `get_latest_weekly_review` lesen. Alle anderen und anonyme Nutzer bleiben serverseitig gesperrt; das gespeicherte KPI-JSON bleibt immer im Backend.
- Die fünf Punkte decken Stärke, größten rechnerischen Funnel-Engpass, Vorwochentrend plus auffällige Conversion, nächste Priorität und genau eine konkrete Handlung ab. Bei zu kleiner Basis muss der dritte Punkt die fehlende Belastbarkeit benennen.
- Die Nettoquote wird vor dem Modellaufruf deterministisch eingeordnet: 70 bis 80 Prozent sind neutraler Standard und keine besondere Stärke; unter 70 Prozent muss der Review die Leadlisten-Qualität als Prüfpunkt nennen, ohne daraus eine bewiesene Ursache zu machen.
- Der Review darf zusätzlich die rein aggregierte offene Antony-Pipeline verwenden. Sie ist eine Momentaufnahme aus dem rollierenden Drei-Monats-Fenster und kein historischer Trend; Lead-IDs, Namen, Notizen und Rohpayloads werden nicht an das Modell gegeben.
- KPI-, Close-, Mapping- und Auth-Logik wurden nicht verändert. Die neue Kette liest ihre Ergebnisse separat.
- Unter dem Wochenreview steht ein kleines Fragefeld. `kpi-assistant` prüft den Supabase-Nutzer und `has_antony_access`, lädt Tag/Woche/Monat sowie den passenden Vorzeitraum serverseitig und sendet nur whitelisted Summen, Quoten, die aggregierte offene Pipeline und den kuratierten Social-Profit-Kontext an OpenAI.
- Fragen und Antworten werden nicht als Chatverlauf gespeichert. `kpi_assistant_usage` enthält nur Nutzer-ID und Zeitstempel für das serverseitige Limit von 20 Fragen je Berliner Kalendertag; Einträge älter als 90 Tage werden automatisch entfernt.
- Der KPI-Assistent nutzt denselben internen Benchmark: 70–80 % Nettoquote sind Standard, unter 70 % ist nur ein Prüfsignal für die Leadlisten-Qualität und keine bewiesene Ursache.

### Einmalige Inbetriebnahme

1. Das kuratierte Social-Profit-Profil liegt lokal außerhalb des öffentlichen Repositorys bereit und wird einmalig als aktive Version `v1` in `weekly_review_contexts` eingespielt. Keine Close-Notizen, Leadtexte oder Einzelfälle übernehmen.
2. In Supabase unter **Edge Functions → Secrets** `OPENAI_API_KEY` anlegen. Den Wert niemals in Git, `config.js` oder SQL eintragen.
3. Optional `OPENAI_MODEL=gpt-5.4-mini-2026-03-17` als Function Secret setzen. Ohne diesen Eintrag nutzt die Function denselben versionierten, Structured-Output-fähigen API-Snapshot bereits als Standard.
4. Migrationen anwenden und danach die Function deployen:

```bash
npx supabase db push --linked
npx supabase functions deploy weekly-review --project-ref pdobcvffnzqxtmkkpfnn
npx supabase functions deploy kpi-assistant --project-ref pdobcvffnzqxtmkkpfnn
```

5. Den privaten Kontext als Version `v1` einspielen. Vor Aktivierung einer neuen Version immer zuerst die alte Version deaktivieren:

```sql
begin;
update public.weekly_review_contexts set active = false where active;
insert into public.weekly_review_contexts (version, active, context)
values ('v1', true, '<INHALT DER AUSGEFÜLLTEN JSON-DATEI>'::jsonb);
commit;
```

6. Einen kontrollierten ersten Lauf auslösen. Den vorhandenen Scheduler-Schlüssel nicht in die Shell-History schreiben; stattdessen verdeckt einlesen:

```bash
read -s WEEKLY_REVIEW_TRIGGER
curl --fail-with-body \
  -X POST \
  -H "content-type: application/json" \
  -H "x-sync-secret: $WEEKLY_REVIEW_TRIGGER" \
  -d '{"referenceDate":"2026-09-07"}' \
  https://pdobcvffnzqxtmkkpfnn.supabase.co/functions/v1/weekly-review
unset WEEKLY_REVIEW_TRIGGER
```

### Verifikation

```sql
select week_start, week_end, iso_year, iso_week, context_version, status, model, generated_at
from public.weekly_reviews
order by week_start desc;

select jobid, jobname, schedule, active
from cron.job
where jobname = 'antony_weekly_review';
```

Erwartung: genau eine abgeschlossene Zeile für die Kalenderwoche und genau fünf Textzeilen. Ein zweiter Aufruf liefert `review_already_exists` und erzeugt keinen weiteren Modellaufruf.

## Missing Context

- Der produktive Wert von `OPENAI_API_KEY` muss durch den Projektinhaber als Supabase Function Secret gesetzt werden.
- Der erste produktive OpenAI-Lauf und der danach sichtbare Reviewtext sind noch nicht verifiziert.
- Nach Setzen des Keys muss eine angemeldete KPI-Frage kontrolliert getestet werden. Vorher zeigt das Feld eine sichere Konfigurationsmeldung und führt keinen OpenAI-Aufruf aus.
- Der Review und der KPI-Assistent sind auf `rigone@socialprofit.de` und `info@socialprofit.de` begrenzt. Die Antony-Navigation und Antony-Datenaufrufe werden im Browser ausgeblendet und zusätzlich durch geschützte RPCs beziehungsweise die Edge Function serverseitig abgewiesen.

## Sources

- Supabase Edge Function `supabase/functions/weekly-review/index.ts`
- Supabase Edge Function `supabase/functions/kpi-assistant/index.ts`
- Datenschutz-Whitelist `supabase/functions/_shared/kpi-assistant.ts`
- Datenbankmigrationen `20260904140000_add_weekly_antony_reviews.sql` und `20260904141000_schedule_weekly_antony_review.sql`
- OpenAI Responses API mit strukturiertem Output und `store: false`

## Timeline

- 2026-09-04: Wochenreview als getrennte, serverseitige und idempotente Kette mit Vorwochenvergleich, genau fünf Punkten und Antony-only-Zugriff implementiert.
- 2026-09-04: Privates Business-Profil `v1`, wöchentlicher Cron und Edge Function in Supabase installiert; aggregierte offene Pipeline als zusätzliche Priorisierungsgrundlage angebunden.
- 2026-09-04: Review vorübergehend für alle freigeschalteten Dashboard-Konten sichtbar gemacht und den serverseitigen, kontingentierten KPI-Assistenten ergänzt. Keine Fragen, Antworten oder Secrets werden im Repository oder als Chatverlauf gespeichert.
- 2026-09-04: Antony-Vollansicht, Antony-KPIs, Zielplan, Wochenreview und KPI-Assistent abschließend auf `rigone@socialprofit.de` und `info@socialprofit.de` begrenzt; alle Regeln werden serverseitig erzwungen.
