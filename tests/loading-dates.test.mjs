import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function germanDate('),source.indexOf('function calendarMonthRange('));
const context=vm.createContext({});
vm.runInContext(functions,context);
test('date labels tolerate missing report dates during initial navigation',()=>{
 for(const value of [null,undefined,'','invalid']) {
  assert.equal(context.germanDate(value),'—');
  assert.equal(context.monthLabel(value),'—');
 }
 assert.equal(context.germanDate('2026-09-09'),'09.09.2026');
 assert.equal(context.monthLabel('2026-09-09'),'September 2026');
});
