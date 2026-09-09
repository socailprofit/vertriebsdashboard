import assert from "node:assert/strict";
import test from "node:test";
import { CloseReadBudgetError, CloseReadTimeoutError, closeRateResetMs, createCloseReadLimiter, fetchCloseLeadMetadata, redactClosePath } from "../supabase/functions/_shared/close-read-client.ts";

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function clock() {
  let at = 0;
  const timers: Array<{ at: number; resolve: () => void }> = [];
  return { now: () => at, sleep: (ms: number) => new Promise<void>(resolve => timers.push({ at: at + ms, resolve })),
    advance: async (ms: number) => { at += ms; for (const t of [...timers]) if (t.at <= at) { timers.splice(timers.indexOf(t), 1); t.resolve(); } await flush(); } };
}

test("429 honors Retry-After and rate-limit reset before retrying the idempotent read", async () => {
  let at = 0, calls = 0; const starts: number[] = [], waits: number[] = [];
  const limiter = createCloseReadLimiter({ now: () => at, sleep: async ms => { waits.push(ms); at += ms; }, minSpacingMs: 0 });
  const response = await limiter.run(async () => { starts.push(at); calls++; return calls === 1
    ? new Response("PRIVATE_CRM_ERROR", { status: 429, headers: { "Retry-After": "2", RateLimit: "limit=100, remaining=0, reset=1.2" } })
    : new Response("ok"); });
  assert.equal(response.status, 200); assert.deepEqual(starts, [0, 2000]); assert.deepEqual(waits, [2000]);
  assert.equal(limiter.diagnostics.rateLimitRetries, 1); assert(!JSON.stringify(limiter.diagnostics).includes("PRIVATE_"));
});
test("the shared admission queue spaces concurrent requests instead of starting an unbounded burst", async () => {
  const c = clock(), starts: number[] = [];
  const limiter = createCloseReadLimiter({ ...c, minSpacingMs: 100 });
  const jobs = Array.from({ length: 3 }, () => limiter.run(async () => { starts.push(c.now()); return new Response("ok"); }));
  await flush(); assert.deepEqual(starts, [0]);
  await c.advance(99); assert.deepEqual(starts, [0]);
  await c.advance(1); assert.deepEqual(starts, [0, 100]);
  await c.advance(100); assert.deepEqual(starts, [0, 100, 200]);
  await Promise.all(jobs);
});
test("a 429 cooldown blocks additional concurrent reads as well as the rejected read's retry", async () => {
  const c = clock(), starts: number[] = []; let first = true;
  const limiter = createCloseReadLimiter({ ...c, minSpacingMs: 100 });
  const execute = async () => { starts.push(c.now()); if (first) { first = false; return new Response(null, { status: 429, headers: { "Retry-After": "2" } }); } return new Response("ok"); };
  const a = limiter.run(execute); await flush();
  const b = limiter.run(execute); await flush();
  assert.deepEqual(starts, [0]); await c.advance(1999); assert.deepEqual(starts, [0]);
  await c.advance(1); assert.deepEqual(starts, [0, 2000]);
  await c.advance(100); assert.deepEqual(starts, [0, 2000, 2100]); await Promise.all([a, b]);
});
test("401 and non-rate-limit failures are returned once without a speculative retry", async () => {
  for (const status of [400, 401, 403, 404, 500]) {
    let calls = 0;
    const limiter = createCloseReadLimiter({ minSpacingMs: 0 });
    assert.equal((await limiter.run(async () => { calls++; return new Response(null, { status }); })).status, status);
    assert.equal(calls, 1);
  }
});
test("long Retry-After stops at the elapsed budget without issuing another request or shortening the server wait", async () => {
  let calls = 0, slept = 0;
  const limiter = createCloseReadLimiter({ now: () => 0, sleep: async ms => { slept += ms; }, maxElapsedMs: 5000 });
  await assert.rejects(() => limiter.run(async () => { calls++; return new Response(null, { status: 429, headers: { "Retry-After": "60" } }); }), CloseReadBudgetError);
  assert.equal(calls, 1); assert.equal(slept, 0);
});
test("the default read deadline accommodates a 125-second fetch but stops at 130 seconds", async () => {
  let at = 0;
  const limiter = createCloseReadLimiter({ now: () => at, minSpacingMs: 0 });
  at = 125_000;
  assert.equal((await limiter.run(async () => new Response("ok"))).status, 200);
  assert.equal(limiter.isBudgetExhausted(), false);
  at = 130_000;
  assert.equal(limiter.isBudgetExhausted(), true);
  await assert.rejects(() => limiter.run(async () => new Response("unexpected")), CloseReadBudgetError);
});
test("aborted reads distinguish the per-request limit from the total snapshot deadline", async () => {
  for (const [options, expected] of [
    [{ requestTimeoutMs: 5, maxElapsedMs: 1000 }, CloseReadTimeoutError],
    [{ requestTimeoutMs: 1000, maxElapsedMs: 5 }, CloseReadBudgetError],
  ] as const) {
    const limiter = createCloseReadLimiter({ ...options, minSpacingMs: 0 });
    // AbortSignal.timeout does not itself keep Node's test process alive.
    const keepAlive = setTimeout(() => {}, 100);
    try {
      await assert.rejects(() => limiter.run(signal => new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })), expected);
      assert.equal(limiter.diagnostics.requests, 1);
    } finally { clearTimeout(keepAlive); }
  }
});
test("429 retries are bounded even when every response asks for a short wait", async () => {
  let at = 0, calls = 0;
  const limiter = createCloseReadLimiter({ now: () => at, sleep: async ms => { at += ms; }, max429Retries: 2, minSpacingMs: 0 });
  const response = await limiter.run(async () => { calls++; return new Response(null, { status: 429, headers: { "Retry-After": "1" } }); });
  assert.equal(response.status, 429); assert.equal(calls, 3); assert.equal(at, 2000);
});
test("successful exhausted-bucket responses pause the next request proactively", async () => {
  let at = 0;
  const limiter = createCloseReadLimiter({ now: () => at, sleep: async ms => { at += ms; }, minSpacingMs: 0 });
  await limiter.run(async () => new Response("ok", { headers: { RateLimit: "limit=1, remaining=0, reset=1.25" } }));
  await limiter.run(async () => { assert.equal(at, 1250); return new Response("ok"); });
});
test("rate-reset parsing accepts decimal reset, legacy reset and HTTP-date Retry-After", () => {
  const now = Date.parse("2026-09-08T15:00:00Z");
  assert.equal(closeRateResetMs(new Headers({ "Retry-After": "Tue, 08 Sep 2026 15:00:03 GMT", RateLimit: "limit=100, remaining=0, reset=2.1" }), now), 3000);
  assert.equal(closeRateResetMs(new Headers({ "x-rate-limit-reset": "0.125" }), now), 125);
  assert.equal(closeRateResetMs(new Headers({ "Retry-After": "garbage" }), now), 0);
});
test("public Close paths retain endpoint context while removing object IDs and query values", () => {
  assert.equal(redactClosePath("/lead/lead_PRIVATE_ID/?secret=PRIVATE"), "/lead/:id/");
  assert.equal(redactClosePath("/activity/custom/acti_PRIVATE/"), "/activity/custom/:id/");
  assert.equal(redactClosePath("/data/search/"), "/data/search/");
});
test("201 lead identities use three exact read-only search batches with only requested metadata", async () => {
  const ids = Array.from({ length: 201 }, (_, i) => `lead-${String(i).padStart(3, "0")}`), bodies: Record<string, unknown>[] = [];
  const rows = await fetchCloseLeadMetadata(ids, ["id", "status_id"], async body => {
    bodies.push(body); const query = body.query as { queries: Array<{ queries?: Array<{ value: string }> }> };
    return { data: query.queries[1].queries!.map(q => ({ id: q.value, status_id: "status" })), cursor: null };
  });
  assert.equal(bodies.length, 3); assert.deepEqual(rows.map(r => r.id), ids);
  assert.deepEqual(bodies[0]._fields, { lead: ["id", "status_id"] }); assert.equal(bodies[0]._limit, 100);
  assert(!("results_limit" in bodies[0]));
});
test("lead search follows every cursor and rejects missing, foreign or duplicate identities", async () => {
  let pages = 0;
  const rows = await fetchCloseLeadMetadata(["a", "b"], ["id"], async body => ++pages === 1
    ? { data: [{ id: "a" }], cursor: "cursor-1" }
    : (assert.equal(body.cursor, "cursor-1"), { data: [{ id: "b" }], cursor: null }));
  assert.equal(rows.length, 2); assert.equal(pages, 2);
  await assert.rejects(() => fetchCloseLeadMetadata(["a", "b"], ["id"], async () => ({ data: [{ id: "a" }], cursor: null })), /incomplete_funnel_lead_metadata/);
  await assert.rejects(() => fetchCloseLeadMetadata(["a"], ["id"], async () => ({ data: [{ id: "other" }], cursor: null })), /unstable_funnel_lead_search/);
  await assert.rejects(() => fetchCloseLeadMetadata(["a"], ["id"], async () => ({ data: [{ id: "a" }, { id: "a" }], cursor: null })), /unstable_funnel_lead_search/);
});
