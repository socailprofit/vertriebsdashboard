import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCallTimeProfile } from '../call-time-view.mjs';

const people = [{slug:'michael',display_name:'Michael Giesbrecht',color:'#458bff'},
  {slug:'felix',display_name:'Felix Wenk',color:'#ffa900'}];
const row = (slug, metric_hour, appointments) => ({ slug, metric_hour, calls_gross:30, calls_net:20,
  productive_calls:20, gatekeeper_contacts:10, connected_calls:5, decision_maker_contacts:10, appointments,
  period_start:'2026-09-01',period_end:'2026-09-09', gf_unavailable_calls:3 });

test('Teamempfehlungen bleiben personenspezifisch und Unter-KPIs sind per Klick zugaenglich', () => {
  const html = renderCallTimeProfile([row('michael',9,2),row('michael',10,3),row('felix',13,2)], people, 'appointment');
  assert.match(html, /data-hour-rank="1" data-person="michael"/);
  assert.match(html, /data-hour-rank="2" data-person="michael"/);
  assert.match(html, /data-hour-rank="1" data-person="felix"/);
  assert.doesNotMatch(html, /data-hour-rank="2" data-person="felix"/);
  assert.match(html, /GF\/Entscheider nicht erreicht/);
  assert.match(html, /Nettoquote/);
  assert.match(html, /Durchstellung \(durchgestellt/);
  assert.match(html, /01.09.2026–09.09.2026/);
  assert.match(html, /data-chart-point=/);
});

test('leere und widerspruechliche Zeitfenster bleiben ohne Rang', () => {
  const html = renderCallTimeProfile([{...row('felix',9,12)}], [people[1]], 'appointment');
  assert.doesNotMatch(html, /data-hour-rank=/);
  assert.match(html, /Widersprüchliche Zähler/);
  assert.match(renderCallTimeProfile([], people), /Noch kein Zeitfenster/);
});

test('Namen und Farben aus Berichten koennen keine HTML-Inhalte einschleusen', () => {
  const html = renderCallTimeProfile([row('x',9,2)], [{slug:'x',display_name:'<img src=x onerror=alert(1)>',color:'red; background:url(evil)'}]);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /background:url/);
  assert.match(html, /&lt;img/);
});
