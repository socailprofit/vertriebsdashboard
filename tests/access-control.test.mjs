import assert from "node:assert/strict";
import test from "node:test";
import { hasAntonyDashboardAccess, hasWeeklyReviewAccess } from "../access-control.mjs";

test("Antony view is limited to the two approved accounts", () => {
  assert.equal(hasAntonyDashboardAccess("rigone@socialprofit.de"), true);
  assert.equal(hasAntonyDashboardAccess(" INFO@SOCIALPROFIT.DE "), true);
  assert.equal(hasAntonyDashboardAccess("f.wenk@socialprofit.de"), false);
  assert.equal(hasAntonyDashboardAccess("m.giesbrecht@socialprofit.de"), false);
  assert.equal(hasAntonyDashboardAccess("rigone@other-domain.test"), false);
  assert.equal(hasAntonyDashboardAccess(null), false);
});

test("team weekly review is available to both full-access leadership accounts", () => {
  assert.equal(hasWeeklyReviewAccess(" RIGONE@SOCIALPROFIT.DE "), true);
  assert.equal(hasWeeklyReviewAccess("info@socialprofit.de"), true);
  for (const email of [ "f.wenk@socialprofit.de", "m.giesbrecht@socialprofit.de", null]) {
    assert.equal(hasWeeklyReviewAccess(email), false);
  }
});
