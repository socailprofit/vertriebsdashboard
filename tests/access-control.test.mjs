import assert from "node:assert/strict";
import test from "node:test";
import { hasAntonyDashboardAccess, hasWeeklyReviewAccess } from "../access-control.mjs";

for (const check of [hasAntonyDashboardAccess, hasWeeklyReviewAccess]) {
  test(`${check.name}: server grant and completed password setup are required`, () => {
    assert.equal(check({ antonyAccess: true, mustChangePassword: false }), true);
    for (const profile of [null, {}, { role: "manager" },
      { antonyAccess: false, mustChangePassword: false },
      { antonyAccess: true, mustChangePassword: true },
      { antonyAccess: "true", mustChangePassword: false },
      { user_metadata: { antonyAccess: true }, mustChangePassword: false }]) {
      assert.equal(check(profile), false);
    }
  });
}
