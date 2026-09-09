import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { prepareCloseFunnelUpload, uploadCloseFunnelSnapshot, FUNNEL_UPLOAD_MAX_REQUEST_BYTES } from "../supabase/functions/_shared/close-funnel-upload.ts";
const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const snapshot = () => ({ p_start_date: "2026-07-01", p_end_date: "2026-09-10", p_snapshot_started_at: "2026-09-10T11:40:00Z",
  p_raw: [], p_facts: [], p_opportunities: [], p_leads: [], p_bookings: [], p_meetings: [], p_calendar_leads: [],
  p_events: [{ source_event_id: "PRIVATE_ID", payload: { text: 'äö😀"\\\nPRIVATE_VALUE' } }], p_processes: [],
  p_meeting_relations: [], p_event_relations: [], p_funnel_leads: [], p_status_created_since: "2026-07-01T00:00:00Z" });
const ok = (data: unknown) => ({ data, error: null });
test("splits a production-size snapshot at row boundaries within the exact 256 KiB escaped RPC limit", async () => {
  const data = { ...snapshot(), p_events: Array.from({ length: 6543 }, (_, i) => ({ id: i, text: 'a😀"\\\n'.repeat(160) })) };
  const plan = await prepareCloseFunnelUpload(runId, data);
  assert(plan.diagnostics.chunks > 40);
  assert(plan.diagnostics.maxRequestBytes <= FUNNEL_UPLOAD_MAX_REQUEST_BYTES);
  assert(plan.diagnostics.payloadBytes > 9_000_000);
  assert.deepEqual(plan.chunks.filter(c => c.section === "p_events").flatMap(c => JSON.parse(c.text)), data.p_events);
  for (const c of plan.chunks) {
    assert.equal(c.spec.sha256, createHash("sha256").update(c.text, "utf8").digest("hex"));
    assert.equal(c.spec.bytes, Buffer.byteLength(c.text, "utf8"));
    assert.equal(c.requestBytes, Buffer.byteLength(JSON.stringify({ p_run_id: runId, p_section: c.section, p_chunk_index: c.index, p_payload_text: c.text })));
  }
  assert.deepEqual((await prepareCloseFunnelUpload(runId, data)).manifest, plan.manifest);
  assert(!JSON.stringify(plan.diagnostics).includes("PRIVATE"));
});
test("rejects missing sections, oversized individual rows and invalid limits without sending requests", async () => {
  await assert.rejects(prepareCloseFunnelUpload(runId, { ...snapshot(), p_events: undefined }), /section_type/);
  await assert.rejects(prepareCloseFunnelUpload(runId, { ...snapshot(), extra: [] }), /sections/);
  await assert.rejects(prepareCloseFunnelUpload(runId, { ...snapshot(), p_events: [{ text: "x".repeat(300000) }] }), /row_too_large/);
  let calls = 0;
  await assert.rejects(uploadCloseFunnelSnapshot({ runId, snapshot: snapshot(), cleanupBudgetMs: 0, concurrency: 8, rpc: async () => { calls++; return ok(null); } }), /invalid_funnel_upload_limits/);
  assert.equal(calls, 0);
});
test("waits for every concurrent chunk before the single small finalize and emits bounded content-free progress", async () => {
  let inFlight = 0, peak = 0, puts = 0, finals = 0;
  const progress: unknown[] = [];
  const result = await uploadCloseFunnelSnapshot({ runId, snapshot: snapshot(), cleanupBudgetMs: 0, onProgress: p => { progress.push(p); },
    rpc: async (name, args) => {
      assert(Buffer.byteLength(JSON.stringify(args)) <= FUNNEL_UPLOAD_MAX_REQUEST_BYTES);
      if (name === "begin_close_funnel_upload") return ok({ state: "uploading" });
      if (name === "put_close_funnel_upload_chunk") {
        inFlight++; peak = Math.max(peak, inFlight); await new Promise(resolve => setTimeout(resolve, 2)); inFlight--; puts++;
        return ok({ state: "uploading", stored: true });
      }
      assert.equal(inFlight, 0); assert.equal(puts, 16); assert.deepEqual(args, { p_run_id: runId }); finals++;
      return ok({ funnel_events: 1, processes: 0 });
    } });
  assert.equal(peak, 3); assert.equal(finals, 1); assert.equal(result.diagnostics.requests, 18);
  assert.equal(progress.length, 5); assert(!JSON.stringify(progress).includes("PRIVATE"));
});
test("an uncertain chunk response retries the exact immutable chunk before any finalization", async () => {
  const attempts: string[] = []; let first = true;
  const result = await uploadCloseFunnelSnapshot({ runId, snapshot: snapshot(), cleanupBudgetMs: 0, concurrency: 1, rpc: async (name, args) => {
    if (name === "begin_close_funnel_upload") return ok({ state: "uploading" });
    if (name === "put_close_funnel_upload_chunk") {
      attempts.push(JSON.stringify(args));
      if (first) { first = false; throw new TypeError("PRIVATE transport detail"); }
      return ok({ state: "uploading", stored: false });
    }
    return ok({ funnel_events: 1 });
  } });
  assert.equal(attempts[0], attempts[1]); assert.equal(result.diagnostics.retries, 1);
});
test("an uncertain committed finalization retries only run ID and receives the cached result", async () => {
  let finals = 0;
  const result = await uploadCloseFunnelSnapshot({ runId, snapshot: snapshot(), cleanupBudgetMs: 0, rpc: async (name, args) => {
    if (name === "begin_close_funnel_upload") return ok({ state: "uploading" });
    if (name === "put_close_funnel_upload_chunk") return ok({ state: "uploading" });
    assert.deepEqual(args, { p_run_id: runId });
    if (++finals === 1) throw new TypeError("lost response");
    return ok({ funnel_events: 1 });
  } });
  assert.equal(finals, 2); assert.equal(result.diagnostics.retries, 1);
});
test("a resumed already committed run sends only Begin and returns the existing result", async () => {
  let calls = 0;
  const result = await uploadCloseFunnelSnapshot({ runId, snapshot: snapshot(), cleanupBudgetMs: 0, rpc: async name => {
    calls++; assert.equal(name, "begin_close_funnel_upload"); return ok({ state: "committed", result: { funnel_events: 1 } });
  } });
  assert.equal(calls, 1); assert.equal(result.diagnostics.resumedCommitted, true);
});
test("permission, expired JWT and business guard failures are never retried or exposed", async () => {
  for (const code of ["42501", "P0001", "PGRST301", "PGRST303"]) {
    let calls = 0;
    await assert.rejects(uploadCloseFunnelSnapshot({ runId, snapshot: snapshot(), cleanupBudgetMs: 0, rpc: async () => {
      calls++; return { data: null, error: { code, message: "PRIVATE token expired or source detail" } };
    } }), error => String(error).includes(code) && !String(error).includes("PRIVATE"));
    assert.equal(calls, 1);
  }
});
test("short transient issued-at clock skew and aborted SQL transactions have bounded retries", async () => {
  for (const error of [{ code: "57014", message: "statement timeout" }, { code: "PGRST303", message: "JWT issued at future" }]) {
    let calls = 0;
    const result = await uploadCloseFunnelSnapshot({ runId, snapshot: snapshot(), cleanupBudgetMs: 0, rpc: async () => {
      if (++calls === 1) return { data: null, error };
      return ok({ state: "committed", result: { funnel_events: 1 } });
    } });
    assert.equal(calls, 2); assert.equal(result.diagnostics.retries, 1);
  }
});
test("a failed chunk aborts and settles other workers; no finalize or silent background work remains", async () => {
  let active = 0, finals = 0;
  await assert.rejects(uploadCloseFunnelSnapshot({ runId, snapshot: snapshot(), cleanupBudgetMs: 0, rpc: async (name, args, signal) => {
    if (name === "begin_close_funnel_upload") return ok({ state: "uploading" });
    if (name === "finalize_close_funnel_upload") { finals++; return ok({}); }
    if (args.p_section === "p_start_date") return { data: null, error: { code: "P0001", message: "bad source" } };
    active++;
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    active--; throw new TypeError("aborted");
  } }), /rpc_P0001/);
  assert.equal(active, 0); assert.equal(finals, 0);
});
test("overall upload deadline aborts in-flight RPC and prevents finalization", async () => {
  let calls = 0;
  await assert.rejects(uploadCloseFunnelSnapshot({ runId, snapshot: snapshot(), cleanupBudgetMs: 0, budgetMs: 100, rpc: async (_name, _args, signal) => {
    calls++;
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    throw new TypeError("request aborted");
  } }), /aborted|budget_exhausted/);
  assert.equal(calls, 1);
});
test("a returned PostgREST abort at finalization reports the deadline without retrying or leaking details", async () => {
  let finals = 0;
  await assert.rejects(uploadCloseFunnelSnapshot({ runId, snapshot: snapshot(), cleanupBudgetMs: 0, budgetMs: 100,
    rpc: async (name, _args, signal) => {
      if (name !== "finalize_close_funnel_upload") return ok({ state: "uploading" });
      finals++;
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      return { data: null, error: { code: "", message: "AbortError: PRIVATE request detail" } };
    },
  }), error => String(error).includes("funnel_upload_budget_exhausted") && !String(error).includes("PRIVATE"));
  assert.equal(finals, 1);
});
test("post-commit cleanup drains more than one import in bounded batches without changing success", async () => {
  let chunks = 66, cleanupCalls = 0;
  const result = await uploadCloseFunnelSnapshot({ runId, snapshot: snapshot(), rpc: async name => {
    if (name === "begin_close_funnel_upload") return ok({ state: "committed", result: { funnel_events: 1 } });
    assert.equal(name, "cleanup_close_funnel_upload_chunks"); cleanupCalls++;
    const removed = Math.min(chunks, 16); chunks -= removed; return ok(removed);
  } });
  assert.equal(result.data.funnel_events, 1); assert.equal(cleanupCalls, 5); assert.equal(chunks, 0);
});
test("late cleanup permission/transport/deadline failures never invalidate a committed result", async () => {
  for (const failure of ["permission", "transport", "timeout"]) {
    const result = await uploadCloseFunnelSnapshot({ runId, snapshot: snapshot(), cleanupBudgetMs: 20, rpc: async (name, _args, signal) => {
      if (name === "begin_close_funnel_upload") return ok({ state: "committed", result: { funnel_events: 1 } });
      if (failure === "permission") return { data: null, error: { code: "42501", message: "PRIVATE error" } };
      if (failure === "timeout") await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      throw new TypeError("PRIVATE maintenance failure");
    } });
    assert.equal(result.data.funnel_events, 1);
  }
});
