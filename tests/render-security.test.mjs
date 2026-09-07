import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { escapeHtml, safeColor } from "../render-security.mjs";

test("database text cannot break out of HTML attributes", () => {
  const payload = '\"><img src=x onerror="alert(1)">&\'';
  assert.equal(escapeHtml(payload), '&quot;&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#039;');
});

test("colour attributes reject CSS and HTML injection", () => {
  for (const payload of ['red; background:url(https://evil.invalid)', '#123456" onmouseover="alert(1)', 'url(javascript:alert(1))']) {
    assert.equal(safeColor(payload), '#8fa3bf');
  }
  assert.equal(safeColor('#3b9dff'), '#3b9dff');
});

test("the real error renderer treats upstream errors as text", () => {
  const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const renderer = source.slice(source.indexOf('function renderSyncBadge()'), source.indexOf('function updateUrl()'));
  const element = { innerHTML: '' };
  vm.runInNewContext(renderer + '\nrenderSyncBadge();', {
    state: { status: 'error', error: '<img src=x onerror="alert(1)">' },
    escapeHtml,
    document: { querySelector: () => element },
  });
  assert.ok(element.innerHTML.includes('&lt;img'));
  assert.ok(!element.innerHTML.includes('<img'));
});
