const encoder = new TextEncoder();
export const FUNNEL_UPLOAD_MAX_REQUEST_BYTES = 256 * 1024;
const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
const sections = ["p_start_date", "p_end_date", "p_snapshot_started_at", "p_raw", "p_facts", "p_opportunities", "p_leads",
  "p_bookings", "p_meetings", "p_calendar_leads", "p_events", "p_processes", "p_meeting_relations",
  "p_event_relations", "p_funnel_leads", "p_status_created_since"] as const;
const scalars = new Set<string>(["p_start_date", "p_end_date", "p_snapshot_started_at", "p_status_created_since"]);
type ChunkSpec = { sha256: string; bytes: number; rows: number };
export type FunnelUploadManifest = Record<string, { rows: number; chunks: ChunkSpec[] }>;
export type FunnelUploadChunk = { section: string; index: number; text: string; spec: ChunkSpec; requestBytes: number };
export type FunnelUploadPlan = {
  runId: string; snapshotStartedAt: string; manifest: FunnelUploadManifest; chunks: FunnelUploadChunk[];
  diagnostics: { chunks: number; payloadBytes: number; wireBytes: number; maxRequestBytes: number };
};
export type FunnelUploadProgress = {
  phase: "prepared" | "uploading" | "finalizing" | "committed";
  completedChunks: number; totalChunks: number; payloadBytes: number; elapsedMs: number;
};
export class FunnelUploadError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "FunnelUploadError"; }
}
export type FunnelUploadRpc = (name: string, args: Record<string, unknown>, signal: AbortSignal) =>
  PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

const bytes = (value: string) => encoder.encode(value).byteLength;
const chunkArgs = (runId: string, section: string, index: number, text: string) =>
  ({ p_run_id: runId, p_section: section, p_chunk_index: index, p_payload_text: text });
const wireBytes = (args: Record<string, unknown>) => bytes(JSON.stringify(args));
const fail = (code: string): never => { throw new FunnelUploadError(code); };

/** Splits only at row boundaries. The limit applies to the complete RPC JSON
 * body, including double escaping when the JSON chunk is carried as text. */
export async function prepareCloseFunnelUpload(runId: string, snapshot: Record<string, unknown>): Promise<FunnelUploadPlan> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) fail("invalid_funnel_upload_id");
  if (Object.keys(snapshot).length !== sections.length || sections.some(key => !(key in snapshot))) fail("invalid_funnel_upload_sections");
  const snapshotStartedAt = snapshot.p_snapshot_started_at;
  if (typeof snapshotStartedAt !== "string" || !Number.isFinite(Date.parse(snapshotStartedAt))) fail("invalid_funnel_upload_time");
  const manifest: FunnelUploadManifest = {}, chunks: FunnelUploadChunk[] = [];
  let payloadBytes = 0, requestBytesTotal = 0, maxRequestBytes = 0;
  for (const section of sections) {
    const value = snapshot[section], isScalar = scalars.has(section);
    if (isScalar ? typeof value !== "string" : !Array.isArray(value)) fail("invalid_funnel_upload_section_type");
    const sectionChunks: FunnelUploadChunk[] = [];
    const append = async (text: string, rows: number) => {
      const index = sectionChunks.length;
      const requestBytes = wireBytes(chunkArgs(runId, section, index, text));
      const raw = encoder.encode(text);
      if (requestBytes > FUNNEL_UPLOAD_MAX_REQUEST_BYTES || raw.byteLength > FUNNEL_UPLOAD_MAX_REQUEST_BYTES) fail("funnel_upload_row_too_large");
      payloadBytes += raw.byteLength;
      if (payloadBytes > MAX_PAYLOAD_BYTES || chunks.length >= 1024) fail("funnel_upload_capacity_exceeded");
      const digest = await crypto.subtle.digest("SHA-256", raw);
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      const chunk = { section, index, text, spec: { sha256, bytes: raw.byteLength, rows }, requestBytes };
      chunks.push(chunk); sectionChunks.push(chunk);
      requestBytesTotal += requestBytes; maxRequestBytes = Math.max(maxRequestBytes, requestBytes);
    };
    if (isScalar) await append(JSON.stringify(value), 1);
    else {
      const rows = value as unknown[];
      if (rows.length > 200000) fail("funnel_upload_capacity_exceeded");
      // Reserve more than the fixed UUID/section/index argument overhead. Sum
      // escaped row contributions once, avoiding quadratic candidate encoding.
      const contentBudget = FUNNEL_UPLOAD_MAX_REQUEST_BYTES - 1024;
      let parts: string[] = [], used = 2;
      for (const row of rows) {
        const encoded = JSON.stringify(row);
        if (encoded === undefined) fail("invalid_funnel_upload_row");
        const size = bytes(JSON.stringify(encoded)) - 2;
        if (size + 2 > contentBudget) fail("funnel_upload_row_too_large");
        if (used + size + (parts.length ? 1 : 0) > contentBudget) {
          await append(`[${parts.join(",")}]`, parts.length); parts = []; used = 2;
        }
        used += size + (parts.length ? 1 : 0); parts.push(encoded);
      }
      await append(`[${parts.join(",")}]`, parts.length);
    }
    manifest[section] = { rows: isScalar ? 1 : (value as unknown[]).length, chunks: sectionChunks.map(chunk => chunk.spec) };
  }
  const beginBytes = wireBytes({ p_run_id: runId, p_snapshot_started_at: snapshotStartedAt, p_manifest: manifest });
  if (beginBytes > FUNNEL_UPLOAD_MAX_REQUEST_BYTES) fail("funnel_upload_manifest_too_large");
  requestBytesTotal += beginBytes + wireBytes({ p_run_id: runId }); maxRequestBytes = Math.max(maxRequestBytes, beginBytes);
  return { runId, snapshotStartedAt: snapshotStartedAt as string, manifest, chunks,
    diagnostics: { chunks: chunks.length, payloadBytes, wireBytes: requestBytesTotal, maxRequestBytes } };
}

function retryable(error: { code?: string; message?: string }) {
  return ["57014", "40001", "40P01", "PGRST003"].includes(error.code ?? "") ||
    (error.code === "PGRST303" && /^JWT issued at future\.?$/.test(error.message ?? "")) ||
    (!error.code && /^(TypeError: (fetch failed|Failed to fetch)|FetchError:)/.test(error.message ?? ""));
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => { signal.removeEventListener("abort", aborted); resolve(); };
    const timer = setTimeout(finish, ms);
    const aborted = () => { clearTimeout(timer); signal.removeEventListener("abort", aborted); reject(new FunnelUploadError("funnel_upload_aborted")); };
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

/** Every mutation is idempotent under runId + manifest + chunk identity. Source
 * content is never included in errors/progress. No reporting write occurs until
 * the final small RPC succeeds; SQL also protects against a stale snapshot. */
export async function uploadCloseFunnelSnapshot(options: {
  runId: string; snapshot: Record<string, unknown>; rpc: FunnelUploadRpc;
  onProgress?: (progress: FunnelUploadProgress) => void | Promise<void>;
  signal?: AbortSignal; concurrency?: number; budgetMs?: number; cleanupBudgetMs?: number;
}) {
  const started = performance.now(), budgetMs = options.budgetMs ?? 45000;
  const concurrency = options.concurrency ?? 3;
  const cleanupBudgetMs = options.cleanupBudgetMs ?? 2000;
  if (!Number.isFinite(cleanupBudgetMs) || cleanupBudgetMs < 0 || cleanupBudgetMs > 3000) fail("invalid_funnel_cleanup_limits");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 || !Number.isFinite(budgetMs) || budgetMs < 100 || budgetMs > 60000) fail("invalid_funnel_upload_limits");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let requests = 0, retries = 0, completed = 0;
  const plan = await prepareCloseFunnelUpload(options.runId, options.snapshot).catch(error => { clearTimeout(timer); throw error; });
  const report = async (phase: FunnelUploadProgress["phase"]) => {
    await options.onProgress?.({ phase, completedChunks: completed, totalChunks: plan.chunks.length,
      payloadBytes: plan.diagnostics.payloadBytes, elapsedMs: Math.round(performance.now() - started) });
  };
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted || performance.now() - started >= budgetMs) fail("funnel_upload_budget_exhausted");
      let response;
      try { requests++; response = await options.rpc(name, args, signal); }
      catch (error) {
        if (signal.aborted) fail("funnel_upload_aborted");
        if (!(error instanceof TypeError) || attempt >= 2) fail("funnel_upload_transport_failed");
        retries++; await wait([200, 600][attempt], signal); continue;
      }
      if (!response.error) return response.data;
      // postgrest-js returns an aborted fetch as an error result, rather than
      // rejecting. Preserve the deadline diagnosis in that path as well.
      if (signal.aborted) fail(options.signal?.aborted ? "funnel_upload_aborted" : "funnel_upload_budget_exhausted");
      if (!retryable(response.error) || attempt >= 2) {
        // Codes have a closed format, and neither source values nor JWT claims
        // from database/network messages are exposed to logs or callers.
        const code = /^[A-Z0-9]{5,10}$/.test(response.error.code ?? "") ? response.error.code : "failed";
        fail(`funnel_upload_rpc_${code}`);
      }
      retries++; await wait([200, 600][attempt], signal);
    }
  };
  // Maintenance starts only after publication is confirmed. A separate short
  // budget and caught failures prevent cleanup from reclassifying a good sync.
  const cleanupCommitted = async () => {
    if (!cleanupBudgetMs || options.signal?.aborted) return;
    const cleanupController = new AbortController();
    const cleanupTimer = setTimeout(() => cleanupController.abort(), cleanupBudgetMs);
    const cleanupSignal = options.signal ? AbortSignal.any([options.signal, cleanupController.signal]) : cleanupController.signal;
    try {
      for (let batch = 0; batch < 8 && !cleanupSignal.aborted; batch++) {
        const result = await options.rpc("cleanup_close_funnel_upload_chunks", { p_limit: 16 }, cleanupSignal);
        if (result.error || !Number.isInteger(result.data) || (result.data as number) < 0 || (result.data as number) < 16) break;
      }
    } catch { /* Already committed; next successful run drains any remainder. */ }
    finally { clearTimeout(cleanupTimer); }
  };
  try {
    await report("prepared");
    const begun = await call("begin_close_funnel_upload", { p_run_id: plan.runId, p_snapshot_started_at: plan.snapshotStartedAt, p_manifest: plan.manifest }) as { state?: string; result?: unknown } | null;
    if (begun?.state === "committed") {
      if (!begun.result || typeof begun.result !== "object" || Array.isArray(begun.result)) fail("invalid_funnel_upload_result");
      await report("committed");
      await cleanupCommitted();
      return { data: begun.result, diagnostics: { ...plan.diagnostics, requests, retries, resumedCommitted: true } };
    }
    if (begun?.state !== "uploading") fail("invalid_funnel_upload_begin_response");
    let next = 0;
    const checkpointEvery = Math.max(10, Math.ceil(plan.chunks.length / 4));
    const workers = Array.from({ length: Math.min(concurrency, plan.chunks.length) }, async () => {
      while (next < plan.chunks.length && !signal.aborted) {
        const chunk = plan.chunks[next++];
        const result = await call("put_close_funnel_upload_chunk", chunkArgs(plan.runId, chunk.section, chunk.index, chunk.text)) as { state?: string } | null;
        if (result?.state !== "uploading") fail("invalid_funnel_upload_chunk_response");
        completed++;
        if (completed % checkpointEvery === 0 || completed === plan.chunks.length) await report("uploading");
      }
    });
    // Abort other outstanding requests on failure and await their settlement.
    // This prevents a failed turn from leaving invisible uploads running.
    await Promise.all(workers).catch(async error => { controller.abort(); await Promise.allSettled(workers); throw error; });
    if (completed !== plan.chunks.length) fail("funnel_upload_incomplete");
    await report("finalizing");
    const data = await call("finalize_close_funnel_upload", { p_run_id: plan.runId });
    if (!data || typeof data !== "object" || Array.isArray(data)) fail("invalid_funnel_upload_result");
    await report("committed");
    await cleanupCommitted();
    return { data, diagnostics: { ...plan.diagnostics, requests, retries, resumedCommitted: false } };
  } finally { clearTimeout(timer); }
}
