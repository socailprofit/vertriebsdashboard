import assert from "node:assert/strict";
import test from "node:test";
import { retrySnapshotSelect, safeSupabaseJwtIssue } from "../supabase/functions/_shared/snapshot-read-retry.ts";

test("SELECT recovers from PGRST303 using a fresh invocation with bounded short delays", async () => {
  let calls = 0; const waits: number[] = [];
  const result = await retrySnapshotSelect(async () => ++calls < 3
    ? { error: { code: "PGRST303" }, data: null }
    : { error: null, data: ["complete-page"] }, async ms => { waits.push(ms); });
  assert.equal(calls, 3); assert.deepEqual(waits, [500, 1500]); assert.deepEqual(result.data, ["complete-page"]);
});
test("persistent JWT validation failure remains an error after exactly two retries", async () => {
  let calls = 0; const waits: number[] = [];
  const result = await retrySnapshotSelect(async () => { calls++; return { error: { code: "PGRST303" }, data: null }; }, async ms => { waits.push(ms); });
  assert.equal(calls, 3); assert.equal(result.error?.code, "PGRST303"); assert.deepEqual(waits, [500, 1500]);
});
test("other database/auth errors and thrown network failures do not enter this retry policy", async () => {
  for (const code of ["42501", "PGRST301", "PGRST302", "23505", "57014", undefined]) {
    let calls = 0;
    await retrySnapshotSelect(async () => { calls++; return { error: { code } }; }, async () => assert.fail("unexpected retry"));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(() => retrySnapshotSelect(async () => { calls++; throw new Error("network"); }));
  assert.equal(calls, 1);
});
test("JWT diagnostics expose fixed classifications and never server text, token data or claims", () => {
  for (const [message, expected] of [["JWT issued at future", "issued_in_future"], ["JWT expired SECRET_TOKEN", "expired"],
    ["JWT not yet valid", "not_yet_valid"], ["JWT signature does not match SECRET_TOKEN", "signature_validation"],
    ["JWT parsing failed SECRET_TOKEN", "jwt_parsing"], ["PRIVATE_UNRECOGNIZED_MESSAGE", "jwt_claims_validation"]]) {
    assert.equal(safeSupabaseJwtIssue({ code: "PGRST303", message }), expected);
  }
  assert.equal(safeSupabaseJwtIssue({ code: "42501", message: "JWT expired SECRET_TOKEN" }), null);
  assert.equal(safeSupabaseJwtIssue(null), null);
});
