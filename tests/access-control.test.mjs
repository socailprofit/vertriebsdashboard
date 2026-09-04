import assert from "node:assert/strict";
import test from "node:test";
import { hasAntonyDashboardAccess } from "../access-control.mjs";

test("Antony view is limited to the two approved accounts", () => {
  assert.equal(hasAntonyDashboardAccess("rigone@socialprofit.de"), true);
  assert.equal(hasAntonyDashboardAccess(" INFO@SOCIALPROFIT.DE "), true);
  assert.equal(hasAntonyDashboardAccess("f.wenk@socialprofit.de"), false);
  assert.equal(hasAntonyDashboardAccess("m.giesbrecht@socialprofit.de"), false);
  assert.equal(hasAntonyDashboardAccess("rigone@other-domain.test"), false);
  assert.equal(hasAntonyDashboardAccess(null), false);
});
