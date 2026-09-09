import { escapeHtml, safeColor } from './render-security.mjs?v=2026-09-09-cc2-evidence-fix';
import { analyzeCallTimeWindows, calculateCallTimeQuality, callTimeMetric,
  CALL_TIME_MIN_CALLS, CALL_TIME_MIN_CONTACTS } from './call-time-score.mjs?v=2026-09-09-best-call-times';

const number = (value) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value);
const rate = (value) => value == null ? '–' : `${number(value)} %`;
const hourLabel = (hour) => `${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00`;
const firstName = (person) => person.display_name.split(/\s+/)[0];
const valueLabel = (entry, mode) => mode === 'quality'
  ? entry.metric.value == null ? '–' : `${number(entry.metric.value)} / 100`
  : rate(entry.metric.value);
const ratio = (value, success, base) => `${rate(value)} (${number(success)} / ${number(base)})`;

function periodLabel(rows, fallback) {
  const row = rows.find((entry) => entry.period_start && entry.period_end);
  const date = (value) => String(value).split('-').reverse().join('.');
  return row ? `${date(row.period_start)}–${date(row.period_end)}` : fallback;
}

function pointPayload(person, entry, mode, period) {
  const q = entry.quality;
  return {
    title: `${firstName(person)} · ${hourLabel(entry.hour)} Uhr`,
    time: `${period} · Europe/Berlin`,
    rows: [
      { label: 'Gesamtqualität', value: q.quality == null ? '–' : `${number(q.quality)} / 100 Punkte` },
      { label: 'Anrufe brutto', value: number(q.calls_gross) },
      { label: 'Nettoquote', value: ratio(q.calls_gross && q.calls_net <= q.calls_gross ? q.calls_net / q.calls_gross * 100 : null, q.calls_net, q.calls_gross) },
      { label: 'Erreichbarkeit (produktiv / brutto)', value: ratio(q.rates.productive, q.productive_calls, q.calls_gross) },
      { label: 'Durchstellung (durchgestellt / bewertbares Vorzimmer)', value: ratio(q.rates.connection, q.connected_calls, q.gatekeeper_contacts) },
      { label: 'Entscheider (erreicht / produktiv)', value: ratio(q.rates.decision, q.decision_maker_contacts, q.productive_calls) },
      { label: 'Termine (vereinbart / Entscheider)', value: ratio(q.rates.appointment, q.appointments, q.decision_maker_contacts) },
      { label: 'Direkte Entscheiderkontakte', value: number(q.direct_decision_maker_calls) },
      { label: 'GF/Entscheider nicht erreicht', value: number(q.gf_unavailable_calls) },
      { label: 'Davon im Vorzimmer als nicht erreichbar erfasst', value: number(q.gatekeeper_unavailable_calls) },
      { label: 'Vorzimmer: nicht durchgestellt', value: number(q.gatekeeper_rejected) },
      { label: 'Vorzimmer: E-Mail senden', value: number(q.gatekeeper_email_requested) },
      { label: 'Vorzimmer: kein Interesse', value: number(q.gatekeeper_no_interest) },
      { label: 'Mailbox', value: number(q.mailbox_calls) },
      { label: 'Außerhalb der Geschäftszeiten', value: number(q.outside_business_hours_calls) },
      { label: mode === 'quality' ? 'Rangwert (Gesamtqualität)' : 'Rangwert (geglättete Quote)',
        value: entry.rankingValue == null ? '–' : mode === 'quality' ? `${number(entry.rankingValue)} / 100` : rate(entry.rankingValue) },
    ],
    note: `${q.inconsistent.length ? 'Widersprüchliche Zähler und Bezugsgrößen: Dieses Fenster wird nicht empfohlen. ' : ''}Close-Ereignisstunde, nicht die Uhrzeit des gebuchten Termins. GF nicht erreichbar, Mailbox und außerhalb der Geschäftszeiten zählen nicht als abgewiesene Durchstellung. Die sichtbaren Quoten sind ungeschönt; die Rangfolge wird zum persönlichen Zeitraumsmittel geglättet.`,
  };
}

export function renderCallTimeProfile(rows = [], people = [], mode = 'quality', fallbackPeriod = '') {
  const analyses = people.map((person) => {
    const source = rows.filter((row) => row.slug === person.slug);
    return { person, period: periodLabel(source, fallbackPeriod), ...analyzeCallTimeWindows(source, mode) };
  });
  const metricName = callTimeMetric(calculateCallTimeQuality(), mode).label;
  const hours = new Set(Array.from({ length: 10 }, (_, index) => index + 8));
  for (const { windows } of analyses) {
    for (const { hour, quality: q } of windows) {
      if (q.calls_gross || q.calls_net || q.gatekeeper_contacts || q.decision_maker_contacts || q.appointments || q.gf_unavailable_calls) hours.add(hour);
    }
  }
  const point = (analysis, entry) => escapeHtml(JSON.stringify(pointPayload(analysis.person, entry, mode, analysis.period)));
  const recommendations = `<div class="hour-recommendations" aria-label="Zwei beste Zeitfenster je Person">
    ${analyses.map((analysis) => `<section class="hour-person-picks" style="--person-color:${safeColor(analysis.person.color)}">
      <h4>${escapeHtml(firstName(analysis.person))} <span>Top 2 · ${escapeHtml(metricName)}</span></h4>
      ${analysis.ranked.map((entry, index) => `<button type="button" class="hour-pick" data-hour-rank="${index + 1}" data-person="${escapeHtml(analysis.person.slug)}"
        aria-label="${escapeHtml(`${firstName(analysis.person)}: Platz ${index + 1}, ${hourLabel(entry.hour)} Uhr. Alle Unter-KPIs anzeigen`)}" data-chart-point="${point(analysis, entry)}">
        <span class="hour-pick-rank">${index + 1}</span><span class="hour-pick-main"><b>${hourLabel(entry.hour)} Uhr</b>
        <small>${number(entry.quality.calls_gross)} Anrufe · ${number(entry.quality.appointments)} Termine</small></span>
        <span class="hour-pick-value">${valueLabel(entry, mode)}<small>Unter-KPIs ↗</small></span>
      </button>`).join('')}
      ${analysis.ranked.length < 2 ? `<p class="hour-pick-empty">${analysis.ranked.length ? 'Noch kein zweites' : 'Noch kein'} Zeitfenster mit ausreichender Basis und positivem Ergebnis.</p>` : ''}
    </section>`).join('')}
  </div>`;
  const head = `<div class="hour-matrix-head" aria-hidden="true"><span>Uhrzeit</span><span class="hour-bars">${people.map((person) => `<b style="--person-color:${safeColor(person.color)}">${escapeHtml(firstName(person))}</b>`).join('')}</span></div>`;
  const matrix = [...hours].sort((a, b) => a - b).map((hour) => `<div class="hour-row"><span class="hour-label">${hourLabel(hour)}</span><span class="hour-bars">${analyses.map((analysis) => {
    const entry = analysis.windows.find((window) => window.hour === hour) ?? {
      hour, quality: calculateCallTimeQuality(), metric: callTimeMetric(calculateCallTimeQuality(), mode), rankingValue: null, enoughData: false,
    };
    const rank = analysis.ranked.findIndex((candidate) => candidate.hour === hour) + 1;
    const missing = entry.metric.value == null || entry.metric.base === 0;
    const value = missing ? 0 : entry.metric.value;
    return `<button type="button" class="hour-bar ${missing ? 'is-missing' : ''} ${!missing && !entry.enoughData ? 'is-thin' : ''} ${rank ? 'is-best' : ''}"
      style="--person-color:${safeColor(analysis.person.color)}" data-chart-point="${point(analysis, entry)}"
      aria-label="${escapeHtml(`${firstName(analysis.person)}, ${hourLabel(hour)} Uhr, ${metricName} ${valueLabel(entry, mode)}. Alle Unter-KPIs anzeigen`)}">
      <span class="hour-bar-top"><span class="hour-person">${escapeHtml(firstName(analysis.person))}</span><b>${valueLabel(entry, mode)}</b>${rank ? `<em>Top ${rank}</em>` : ''}</span>
      <span class="hour-track"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></span>
      <small class="hour-meta">${number(entry.quality.calls_gross)} Anrufe · ${number(entry.quality.productive_calls)} produktiv · ${number(entry.quality.appointments)} Termine</small>
    </button>`;
  }).join('')}</span></div>`).join('');
  const rule = mode === 'quality'
    ? `Mindestens ${CALL_TIME_MIN_CALLS} Anrufe und ${CALL_TIME_MIN_CONTACTS} produktive Kontakte je Zeitfenster.`
    : `Mindestens ${CALL_TIME_MIN_CALLS} Anrufe und ${mode === 'productive' ? CALL_TIME_MIN_CALLS : CALL_TIME_MIN_CONTACTS} Fälle in der jeweiligen Bezugsgröße je Zeitfenster.`;
  return recommendations + head + matrix + `<details class="hour-rules"><summary>Berechnungsregel · ${escapeHtml(metricName)}</summary>
    <p>Jede Stunde fasst den gewählten Zeitraum in Europe/Berlin zusammen. ${rule} Bei Einzelquoten muss mindestens ein Erfolg vorliegen. Reicht die Basis nicht, wird kein Platz aufgefüllt.</p>
    <p>Gesamtqualität: 35 % produktive Erreichbarkeit, 25 % Durchstellung, je 20 % Entscheider- und Terminquote. Nur berechenbare Stufen gehen anteilig ein. Gesamtqualität sind Punkte, keine Prozentquote.</p>
    <p>Für die Rangfolge werden Quoten mit bis zu fünf Vergleichsfällen aus dem persönlichen Zeitraumsmittel geglättet. Bei Gleichstand zählen zuerst die größere Bezugsgröße, dann mehr Anrufe und zuletzt die frühere Stunde. Angezeigte Quoten und Zähler bleiben die tatsächlich erfassten Werte.</p>
    <p>GF nicht erreichbar, Mailbox und außerhalb der Geschäftszeiten zählen nicht zur Durchstellbasis. Eine nicht berechenbare oder widersprüchliche Quote wird als „–“ gezeigt. Klick auf ein Fenster öffnet alle Unter-KPIs.</p>
  </details>`;
}
