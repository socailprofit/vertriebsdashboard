# Import resilience

The scheduled import remains every five minutes, Monday–Friday 07:30–17:00 Europe/Berlin. This change does not modify CRM selection, mapping, KPI formulas, publication, dashboard rendering or scheduler configuration.

- Read-only Close requests retry one transient failure (network interruption, request timeout, HTTP 408/500/502/503/504). JSON body consumption is part of the same request boundary. Invalid JSON and permanent API/auth errors still fail closed.
- At most three additional transient requests are allowed across an entire snapshot. Existing 429 handling and shared rate-limit cooldown remain. Retry-After is honored; retry admission requires enough room for a full request inside the existing 130-second read budget. Successful reads add no requests.
- Sync status writes retry once within a three-second limit per attempt. Terminal updates only match a running row, so a lost success response cannot subsequently downgrade that success to failure.
- Each write-mode import expires running records older than ten minutes with no completed_at. This exceeds the hosted worker's maximum lifetime. Only operational status changes; no CRM or KPI rows are deleted, copied or fabricated. Diagnostic cleanup failure cannot block the import.
- Incomplete source reads remain rejected. The next scheduled invocation reads the normal source window; there are no extra cron ticks or overnight Close requests.

Validation: transient HTTP/transport failures, body timeouts, malformed JSON, permanent errors, retry limits, elapsed budgets, stale-versus-active status records and existing UI background recovery tests. Deploy only the Edge Function with its existing authentication policy; no SQL migration is required.
