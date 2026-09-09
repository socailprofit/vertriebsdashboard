type ReadOptions = {
  now?: () => number; sleep?: (milliseconds: number) => Promise<void>;
  maxElapsedMs?: number; minSpacingMs?: number; max429Retries?: number; requestTimeoutMs?: number;
};
export class CloseReadBudgetError extends Error {
  constructor() { super("close_read_budget_exhausted"); }
}
export class CloseReadTimeoutError extends Error {
  constructor() { super("close_request_timed_out"); }
}
export type CloseReadLimiter = ReturnType<typeof createCloseReadLimiter>;

function seconds(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number * 1000 : null;
}
export function closeRateResetMs(headers: Headers, now = Date.now()): number {
  const reset = headers.get("ratelimit")?.match(/\breset\s*=\s*"?([0-9.]+)/i)?.[1] ?? null;
  const retry = headers.get("retry-after");
  const retryAfter = seconds(retry) ?? (retry && Number.isFinite(Date.parse(retry)) ? Math.max(0, Date.parse(retry) - now) : null);
  return Math.ceil(Math.max(seconds(reset) ?? 0, seconds(headers.get("x-rate-limit-reset")) ?? 0, retryAfter ?? 0));
}

// One admission queue/cooldown is shared by all concurrent reads in a sync.
// Only idempotent GET and the read-only POST /data/search/ use this limiter.
export function createCloseReadLimiter(options: ReadOptions = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  // Supabase requests expire after 150 s. Reserve 20 s for processing/commit.
  const deadline = now() + (options.maxElapsedMs ?? 130_000);
  const spacing = options.minSpacingMs ?? 50;
  const maxRetries = options.max429Retries ?? 4;
  const requestTimeout = options.requestTimeoutMs ?? 30_000;
  let admission = Promise.resolve();
  let nextStart = 0, blockedUntil = 0;
  const diagnostics = { requests: 0, rateLimitRetries: 0, waitedMs: 0 };
  async function enter() {
    const turn = admission.then(async () => {
      while (true) {
        const delay = Math.max(nextStart, blockedUntil) - now();
        if (now() >= deadline || now() + Math.max(0, delay) >= deadline) throw new CloseReadBudgetError();
        if (delay <= 0) break;
        diagnostics.waitedMs += delay;
        await sleep(delay);
      }
      nextStart = now() + spacing;
    });
    // A failed admission must not leave later reads waiting on a rejected tail.
    admission = turn.catch(() => {});
    await turn;
  }
  async function run(read: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      await enter();
      const remaining = deadline - now();
      if (remaining <= 0) throw new CloseReadBudgetError();
      diagnostics.requests++;
      const signal = AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(requestTimeout, remaining))));
      let response: Response;
      try {
        response = await read(signal);
      } catch (error) {
        if (signal.aborted) throw remaining <= requestTimeout ? new CloseReadBudgetError() : new CloseReadTimeoutError();
        throw error;
      }
      const reset = closeRateResetMs(response.headers, now());
      const remainingHeader = response.headers.get("ratelimit")?.match(/\bremaining\s*=\s*"?([0-9.]+)/i)?.[1];
      if (response.status === 429 || remainingHeader !== undefined && Number(remainingHeader) === 0)
        blockedUntil = Math.max(blockedUntil, now() + (reset || (response.status === 429 ? 1000 : 0)));
      if (response.status !== 429 || attempt >= maxRetries) return response;
      diagnostics.rateLimitRetries++;
      // Discard the rejected response before reusing the connection. Its body
      // may contain organization details and never belongs in diagnostics.
      await response.body?.cancel();
    }
  }
  return { run, diagnostics, isBudgetExhausted: () => now() >= deadline };
}

export function redactClosePath(path: string): string {
  const known = new Set(["lead", "contact", "opportunity", "activity", "call", "custom", "email", "meeting", "task", "status_change", "data", "search"]);
  return "/" + path.split("?")[0].split("/").filter(Boolean).map(part => known.has(part) ? part : ":id").join("/") + "/";
}

type Row = Record<string, unknown>;
export type CloseSearchPage = { data: Row[]; cursor?: string | null };
// Exact-ID batches avoid hundreds of individual Lead GET requests. Search is
// read-only despite POST. No results_limit is used: every requested ID is proven.
export async function fetchCloseLeadMetadata(
  ids: string[], fields: string[], search: (body: Row) => Promise<CloseSearchPage>,
): Promise<Row[]> {
  if (ids.some(id => typeof id !== "string" || !id.length) || ids.length > 20_000) throw new Error("invalid_funnel_lead_batch");
  const uniqueIds = [...new Set(ids)].sort(), output: Row[] = [];
  for (let index = 0; index < uniqueIds.length; index += 100) {
    const batch = uniqueIds.slice(index, index + 100), expected = new Set(batch), rows = new Map<string, Row>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const body: Row = {
        query: { type: "and", queries: [{ type: "object_type", object_type: "lead" },
          { type: "or", queries: batch.map(value => ({ type: "id", value })) }] },
        _fields: { lead: fields }, _limit: 100,
        sort: [{ direction: "asc", field: { type: "regular_field", object_type: "lead", field_name: "date_created" } }],
      };
      if (cursor) body.cursor = cursor;
      const page = await search(body);
      if (!Array.isArray(page.data)) throw new Error("invalid_funnel_lead_search_page");
      for (const row of page.data) {
        if (typeof row.id !== "string" || !expected.has(row.id) || rows.has(row.id)) throw new Error("unstable_funnel_lead_search");
        rows.set(row.id, row);
      }
      if (page.cursor !== undefined && page.cursor !== null && typeof page.cursor !== "string") throw new Error("invalid_funnel_lead_search_cursor");
      cursor = page.cursor || null;
      if (cursor) {
        if (cursors.has(cursor) || page.data.length === 0 || rows.size >= batch.length) throw new Error("unstable_funnel_lead_search_cursor");
        cursors.add(cursor);
      }
    } while (cursor);
    if (rows.size !== batch.length) throw new Error("incomplete_funnel_lead_metadata");
    output.push(...batch.map(id => rows.get(id)!));
  }
  return output;
}
