import { escapeHtml } from './render-security.mjs';

const count = value => value !== null && value !== undefined && Number.isFinite(Number(value)) ? new Intl.NumberFormat('de-DE').format(Number(value)) : '—';
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('.') : '—';
const names = {
  current: ['Ersttermin im gewählten Zeitraum', 'Der erste Setter-Kalendertermin liegt in diesem Zeitraum.'],
  prior: ['Ersttermin aus einem früheren Zeitraum', 'Der erste Setter-Kalendertermin liegt davor. Hier erscheint nur die Arbeit im gewählten Zeitraum.'],
};

function lane(group, planningEnd) {
  const [title, note] = names[group.origin];
  return `<section class="origin-pipeline" aria-label="${title}">
    <header><h4>${title}</h4><p>${note}</p></header>
    <ol class="origin-stages">
      <li><h5>Setter</h5><strong>${count(group.setter_calls)} <span>durchgeführte Gespräche</span></strong><p>${count(group.setter_meetings)} fällige Kalendertermine</p></li>
      <li><h5>Closer</h5><strong>${count(group.closer_calls)} <span>durchgeführte Gespräche</span></strong><p>${group.closer_meetings == null ? 'Kalenderzuordnung noch nicht belegt' : `${count(group.closer_meetings)} fällige Kalendertermine`}</p></li>
      <li><h5>CC2</h5><strong>${count(group.cc2_agreed)} <span>vereinbart</span></strong><p>Vereinbarung ist kein Gespräch</p></li>
      <li><h5>Neukunden</h5><strong>${count(group.new_customers)} <span>erstmals gewonnen</span></strong><p>Einmal je Lead</p></li>
    </ol>
    ${Number(group.future_setter_meetings || 0) + Number(group.future_closer_meetings || 0) > 0 ? `<p class="origin-planning">Noch geplant bis ${date(planningEnd)}: ${count(group.future_setter_meetings)} Setter${group.future_closer_meetings == null ? '' : ` · ${count(group.future_closer_meetings)} Closer`}. Ohne Ergebnisbewertung.</p>` : ''}
  </section>`;
}

export function renderOriginPipelines(report) {
  if (!Array.isArray(report?.groups)) return '<p class="tracking-note">Die getrennten Pipelines sind für diesen Datenstand noch nicht verfügbar.</p>';
  const group = origin => report.groups.find(row => row.origin === origin);
  const unknown = group('unknown');
  const unknownValues = [['setter_meetings','fällige Setter-Termine'],['setter_calls','Setter-Gespräche'],['closer_meetings','fällige Closer-Termine'],['closer_calls','Closer-Gespräche'],['cc2_agreed','CC2-Vereinbarungen'],['new_customers','Neukunden'],['future_setter_meetings','geplante Setter-Termine'],['future_closer_meetings','geplante Closer-Termine']].filter(([key]) => Number(unknown?.[key]) > 0);
  return `<p class="origin-intro">Arbeit vom ${date(report.period_start)} bis ${date(report.period_end)}, getrennt nach dem ersten Setter-Kalendertermin. Das Buchungsdatum bestimmt keine Gruppe.</p>
    ${['current','prior'].map(origin => lane(group(origin) || {origin}, report.planning_end)).join('')}
    ${unknownValues.length ? `<aside class="origin-unassigned"><h4>Ersttermin nicht sicher zugeordnet</h4><p>${unknownValues.map(([key,label]) => `${count(unknown[key])} ${escapeHtml(label)}`).join(' · ')}</p><p>In der Gesamtaktivität enthalten, keiner der beiden Gruppen zugerechnet.</p></aside>` : ''}
    <details class="origin-rules"><summary>So hängen die Zahlen zusammen</summary><p>Beide Gruppen und die nicht zugeordneten Fälle ergeben zusammen die Aktivität des Zeitraums. Jedes Gespräch zählt an seinem tatsächlichen Datum. Ein Setter im August mit Closer im September bleibt in der älteren Gruppe. Ein im August gebuchter erster Setter-Termin im September gehört zur aktuellen Gruppe.</p><p>Die Spalten sind keine Umrechnungsquote: Ein Vorgang kann mehrere Gespräche haben. Fällige Kalendertermine können abgesagt, nicht wahrgenommen oder noch ohne Ergebnis sein. Nur belegte Gespräche bis zum letzten Datenstand zählen als durchgeführt. Zukünftige Termine bleiben Planung.</p></details>`;
}
