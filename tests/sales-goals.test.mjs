import test from "node:test";
import assert from "node:assert/strict";
import { workdaysBetween, goalPeriodRange, salesTargetForRange, grossCallPerformanceClass } from "../sales-goals.mjs";

const targets = ["michael", "felix"].map(sales_person_id => ({
  sales_person_id, period_start: "2026-07-01", period_end: "2026-12-31",
  calls_gross: 19800, appointment_rate_target: 25,
}));
const goal = (period, reference, people = "michael") => salesTargetForRange(targets, people, "calls_gross", goalPeriodRange(period, reference));

test("stored live target is exactly 150 per Monday–Friday", () => {
  assert.equal(workdaysBetween("2026-07-01", "2026-12-31"), 132);
  assert.equal(19800 / 132, 150);
  assert.equal(goal("day", "2026-09-08"), 150);
  assert.equal(goal("day", "2026-09-12"), null);
});

test("a partial current month still has its full month goal", () => {
  for (const person of ["michael", "felix"]) {
    assert.equal(goal("month", "2026-09-01", person), 3300);
    assert.equal(goal("month", "2026-09-08", person), 3300);
    assert.equal(goal("month", "2026-09-30", person), 3300);
    assert.equal(goal("month", "2026-11-10", person), 3150);
  }
  assert.equal(goal("month", "2026-09-08", ["michael", "felix"]), 6600);
  assert.equal(salesTargetForRange(targets, "michael", "calls_gross", {start:"2026-09-01",end:"2026-09-08"}), 900);
});

test("week goals cover Monday–Friday, including a week across month boundary", () => {
  assert.deepEqual(goalPeriodRange("week", "2026-09-01"), {start:"2026-08-31",end:"2026-09-04"});
  assert.equal(goal("week", "2026-09-08"), 750);
  assert.equal(goal("week", "2026-09-13"), 750);
  assert.equal(goal("week", "2026-09-01"), 750);
  assert.equal(goal("week", "2026-09-08", ["michael", "felix"]), 1500);
});

test("workdays are calendar-correct across leap days and DST changes", () => {
  assert.equal(workdaysBetween("2024-02-01", "2024-02-29"), 21);
  assert.equal(workdaysBetween("2026-03-27", "2026-03-30"), 2);
  assert.equal(workdaysBetween("2026-10-23", "2026-10-26"), 2);
  assert.equal(workdaysBetween(null, "2026-09-08"), 0);
});

test("call colour is red below 100, amber from 100, green from 150", () => {
  for (const [value, tone] of [[0,"is-weak"],[99,"is-weak"],[100,"is-ok"],[149,"is-ok"],[150,"is-strong"],[240,"is-strong"]]) {
    assert.equal(grossCallPerformanceClass(value, 150), tone);
  }
  assert.equal(grossCallPerformanceClass(null, 150), "is-neutral");
  assert.equal(grossCallPerformanceClass(10, null), "is-neutral");
});

test("week/month colours scale by elapsed weekdays and team size", () => {
  for (const [elapsedGoal, lower, green] of [[300,200,300],[750,500,750],[900,600,900],[3300,2200,3300],[1800,1200,1800]]) {
    assert.equal(grossCallPerformanceClass(lower - 1, elapsedGoal), "is-weak");
    assert.equal(grossCallPerformanceClass(lower, elapsedGoal), "is-ok");
    assert.equal(grossCallPerformanceClass(green - 1, elapsedGoal), "is-ok");
    assert.equal(grossCallPerformanceClass(green, elapsedGoal), "is-strong");
  }
});

test("no target or missing metric stays unknown; rate targets are not scaled", () => {
  assert.equal(goal("month", "2027-01-10"), null);
  assert.equal(salesTargetForRange(targets,"michael",null,goalPeriodRange("month","2026-09-08")), null);
  assert.equal(salesTargetForRange(targets,"michael","appointment_rate_target",goalPeriodRange("month","2026-09-08")), 25);
  assert.equal(salesTargetForRange(targets,"michael","appointment_rate_target",goalPeriodRange("month","2027-01-08")), null);
});
