import assert from "node:assert/strict";
import test from "node:test";
import { fetchAllClosePages, ClosePaginationError, type CloseOffsetPage, type ClosePageProgress } from "../supabase/functions/_shared/close-list-pages.ts";

type Row = { id: string; value?: number };
const records = (length: number) => Array.from({ length }, (_, i) => ({ id: `record-${i}`, value: i }));
function source(rows: Row[], calls: number[] = []) {
  return async (skip: number, limit: number) => { calls.push(skip); return { data: rows.slice(skip, skip + limit), has_more: skip + limit < rows.length }; };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const failsWith = (code: string) => (error: unknown) => error instanceof ClosePaginationError && error.code === code;

test("an empty or partial first terminal page ends without speculative requests", async () => {
  for (const n of [0, 1, 2]) {
    const calls: number[] = [], rows = records(n), updates: ClosePageProgress[] = [];
    assert.deepEqual(await fetchAllClosePages(source(rows, calls), { pageSize: 2, maxRecords: 20, onProgress: p => { updates.push(p); } }), rows);
    assert.deepEqual(calls, [0]); assert.equal(updates.length, 1); assert.equal(updates[0].complete, true);
  }
});

test("fixed-size nonterminal prefix is read completely with bounded final overfetch", async () => {
  for (const n of [3, 4, 5, 6, 7, 8, 9, 19, 20]) {
    const calls: number[] = [], updates: ClosePageProgress[] = [], rows = records(n);
    const result = await fetchAllClosePages(source(rows, calls), { pageSize: 2, maxRecords: 20, onProgress: p => { updates.push(p); } });
    assert.deepEqual(result, rows); assert(calls.every(offset => offset >= 0 && offset < 20));
    assert.deepEqual(calls, Array.from({ length: calls.length }, (_, i) => i * 2));
    assert.equal(updates.at(-1)?.complete, true); assert.equal(updates.at(-1)?.recordsRead, n);
    assert((updates.at(-1)?.overfetchPages ?? 0) <= 2);
  }
});

test("out-of-order responses retain offset order and never exceed three concurrent page requests", async () => {
  const rows = records(7), pending = new Map<number, ReturnType<typeof deferred<CloseOffsetPage<Row>>>>();
  const batchStarted = deferred<void>(); let active = 0, peak = 0;
  const read = fetchAllClosePages(async (skip, limit) => {
    if (skip === 0) return { data: rows.slice(0, limit), has_more: true };
    active++; peak = Math.max(peak, active);
    const d = deferred<CloseOffsetPage<Row>>(); pending.set(skip, d);
    if (pending.size === 3) batchStarted.resolve();
    try { return await d.promise; } finally { active--; }
  }, { pageSize: 2, maxRecords: 20 });
  await batchStarted.promise;
  for (const skip of [6, 2, 4]) pending.get(skip)!.resolve({ data: rows.slice(skip, skip + 2), has_more: skip < 6 });
  assert.deepEqual(await read, rows); assert.equal(peak, 3); assert.equal(active, 0);
});

test("a terminal page within a batch permits only empty terminal pages at higher offsets", async () => {
  const calls: number[] = [], rows = records(3);
  assert.deepEqual(await fetchAllClosePages(source(rows, calls), { pageSize: 2, maxRecords: 20 }), rows);
  assert.deepEqual(calls, [0, 2, 4, 6]);
  for (const later of [{ data: [{ id: "late" }], has_more: false }, { data: records(2), has_more: true }]) {
    await assert.rejects(() => fetchAllClosePages(async (skip, limit) => skip === 4 ? later : source(rows)(skip, limit),
      { pageSize: 2, maxRecords: 20 }), failsWith("close_pagination_inconsistent"));
  }
});

test("a failure anywhere in a batch rejects the full read and drains its other requests", async () => {
  const pending = new Map<number, ReturnType<typeof deferred<CloseOffsetPage<Row>>>>(), batchStarted = deferred<void>();
  const calls: number[] = []; const failure = new Error("transport_failure"); let finished = false;
  const read = fetchAllClosePages(async (skip) => {
    calls.push(skip); if (skip === 0) return { data: records(2), has_more: true };
    const d = deferred<CloseOffsetPage<Row>>(); pending.set(skip, d); if (pending.size === 3) batchStarted.resolve(); return await d.promise;
  }, { pageSize: 2, maxRecords: 20 });
  const rejected = assert.rejects(read, error => error === failure).then(() => { finished = true; });
  await batchStarted.promise; pending.get(2)!.reject(failure);
  await Promise.resolve(); assert.equal(finished, false);
  pending.get(4)!.resolve({ data: [], has_more: false }); pending.get(6)!.resolve({ data: [], has_more: false });
  await rejected; assert.deepEqual(calls, [0, 2, 4, 6]);
});

test("even failure of an overfetch page rejects a possibly unstable snapshot", async () => {
  const rows = records(3), failure = new Error("overfetch_failed");
  await assert.rejects(() => fetchAllClosePages(async (skip, limit) => {
    if (skip === 6) throw failure; return await source(rows)(skip, limit);
  }, { pageSize: 2, maxRecords: 20 }), error => error === failure);
});

test("duplicate source identities fail closed rather than silently masking pagination drift", async () => {
  for (const rows of [[{ id: "same" }, { id: "same" }], [{ id: "a" }, { id: "b" }, { id: "a" }]]) {
    await assert.rejects(() => fetchAllClosePages(source(rows), { pageSize: 2, maxRecords: 20 }), failsWith("close_pagination_duplicate_id"));
  }
  await assert.rejects(() => fetchAllClosePages(source([{ id: "a", value: 1 }, { id: "b" }, { id: "a", value: 2 }]),
    { pageSize: 2, maxRecords: 20 }), failsWith("close_pagination_duplicate_id"));
});

test("empty or short nonterminal pages cannot hide a missing offset range", async () => {
  for (const data of [[], [{ id: "short" }]]) {
    await assert.rejects(() => fetchAllClosePages(async () => ({ data, has_more: true }),
      { pageSize: 2, maxRecords: 20 }), failsWith("close_pagination_inconsistent"));
  }
});

test("malformed pages, oversized responses and missing IDs are rejected without leaking record data", async () => {
  const invalid = [null, {}, { data: {}, has_more: false }, { data: [], has_more: "false" },
    { data: records(3), has_more: false }, { data: [{}], has_more: false }, { data: [{ id: " " }], has_more: false }];
  for (const page of invalid) {
    await assert.rejects(() => fetchAllClosePages(async () => page as CloseOffsetPage<Row>,
      { pageSize: 2, maxRecords: 20 }), failsWith("close_pagination_invalid_page"));
  }
});

test("the exact 20,000-record safety boundary succeeds only if its last page is terminal", async () => {
  const rows = records(20_000), calls: number[] = [];
  assert.deepEqual(await fetchAllClosePages(source(rows, calls)), rows);
  assert.equal(calls.length, 200); assert.equal(Math.max(...calls), 19_900);
  const overflowCalls: number[] = [];
  await assert.rejects(() => fetchAllClosePages(source(records(20_001), overflowCalls)), failsWith("close_pagination_safety_limit"));
  assert.equal(overflowCalls.length, 200); assert.equal(Math.max(...overflowCalls), 19_900);
});

test("smaller serial windows and an explicit stable identity accessor preserve the same contract", async () => {
  const values = Array.from({ length: 5 }, (_, i) => ({ source_id: String(i) })), calls: number[] = [];
  const got = await fetchAllClosePages(async (skip, limit) => {
    calls.push(skip); return { data: values.slice(skip, skip + limit), has_more: skip + limit < values.length };
  }, { pageSize: 2, maxRecords: 20, concurrency: 1, getId: row => row.source_id });
  assert.deepEqual(got, values); assert.deepEqual(calls, [0, 2, 4]);
});

test("invalid options cannot dispatch any request", async () => {
  for (const options of [{ pageSize: 0 }, { pageSize: 101 }, { maxRecords: 20_001 }, { pageSize: 3, maxRecords: 20 },
    { concurrency: 0 }, { concurrency: 4 }, { pageSize: 100, maxRecords: 50 }]) {
    let calls = 0;
    await assert.rejects(() => fetchAllClosePages(async () => { calls++; return { data: [], has_more: false }; }, options),
      failsWith("close_pagination_invalid_options")); assert.equal(calls, 0);
  }
});
