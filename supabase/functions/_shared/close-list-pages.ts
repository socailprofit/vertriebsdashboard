export type CloseOffsetPage<T> = { data: T[]; has_more: boolean };
export type ClosePageProgress = { pagesFetched: number; recordsRead: number; lastOffset: number; overfetchPages: number; complete: boolean };
export type ClosePaginationCode = "close_pagination_invalid_options" | "close_pagination_invalid_page"
  | "close_pagination_inconsistent" | "close_pagination_duplicate_id" | "close_pagination_safety_limit";

/** Contains only our error vocabulary and numeric offsets, never CRM data. */
export class ClosePaginationError extends Error {
  constructor(readonly code: ClosePaginationCode, readonly offset: number | null = null) {
    super(code); this.name = "ClosePaginationError";
  }
}

type Options<T> = {
  pageSize?: number; maxRecords?: number; concurrency?: number;
  getId?: (record: T) => string;
  onProgress?: (progress: ClosePageProgress) => void | Promise<void>;
};

/**
 * Read one complete offset-paginated resource with at most three outstanding
 * page requests. Callers retain responsibility for their existing shared
 * request limiter, time budget, authentication and any transport retry policy.
 *
 * The first page establishes a full fixed-size prefix. Later batches are
 * accepted in offset order, not response order. A terminal page can cause up to
 * two bounded extra GETs; these must be empty and terminal as well. A short
 * non-terminal page, duplicate ID, hole, response failure or data after the end
 * rejects the entire read. No partial source snapshot is returned.
 */
export async function fetchAllClosePages<T>(
  fetchPage: (skip: number, limit: number) => Promise<CloseOffsetPage<T>>,
  options: Options<T> = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? 100, maxRecords = options.maxRecords ?? 20_000, concurrency = options.concurrency ?? 3;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
    || !Number.isSafeInteger(maxRecords) || maxRecords < pageSize || maxRecords > 20_000 || maxRecords % pageSize !== 0
    || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 3)
    throw new ClosePaginationError("close_pagination_invalid_options");
  const records: T[] = [], ids = new Set<string>();
  let pagesFetched = 0, overfetchPages = 0;
  const progress = async (lastOffset: number, complete: boolean) => {
    await options.onProgress?.({ pagesFetched, recordsRead: records.length, lastOffset, overfetchPages, complete });
  };
  const validate = (value: CloseOffsetPage<T>, offset: number) => {
    if (typeof value !== "object" || value === null || !Array.isArray(value.data)
      || typeof value.has_more !== "boolean" || value.data.length > pageSize)
      throw new ClosePaginationError("close_pagination_invalid_page", offset);
    if (value.has_more && value.data.length !== pageSize)
      throw new ClosePaginationError("close_pagination_inconsistent", offset);
  };
  const append = (page: CloseOffsetPage<T>, offset: number) => {
    for (const record of page.data) {
      const id = options.getId ? options.getId(record)
        : typeof record === "object" && record !== null ? (record as { id?: unknown }).id : undefined;
      if (typeof id !== "string" || !id.trim()) throw new ClosePaginationError("close_pagination_invalid_page", offset);
      // Even equal duplicates imply unstable offsets: silently deduplicating
      // would conceal the possibility of an omitted source object elsewhere.
      if (ids.has(id)) throw new ClosePaginationError("close_pagination_duplicate_id", offset);
      ids.add(id); records.push(record);
    }
  };

  const first = await fetchPage(0, pageSize); pagesFetched++;
  validate(first, 0); append(first, 0);
  if (!first.has_more) { await progress(0, true); return records; }
  await progress(0, false);

  for (let nextOffset = pageSize; ; ) {
    if (nextOffset >= maxRecords) throw new ClosePaginationError("close_pagination_safety_limit", nextOffset);
    const offsets = Array.from({ length: Math.min(concurrency, (maxRecords - nextOffset) / pageSize) }, (_, i) => nextOffset + i * pageSize);
    // Drain the whole bounded batch even if one request fails. No unawaited
    // work can continue into another resource snapshot after this read fails.
    const results = await Promise.allSettled(offsets.map(async offset => await fetchPage(offset, pageSize)));
    pagesFetched += results.length;
    for (const result of results) if (result.status === "rejected") throw result.reason;
    const pages = results.map((result, i) => {
      const page = (result as PromiseFulfilledResult<CloseOffsetPage<T>>).value;
      validate(page, offsets[i]); return page;
    });
    let terminal = false;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i], offset = offsets[i];
      if (terminal) {
        if (page.data.length !== 0 || page.has_more) throw new ClosePaginationError("close_pagination_inconsistent", offset);
        overfetchPages++; continue;
      }
      append(page, offset);
      if (!page.has_more) terminal = true;
    }
    await progress(offsets[offsets.length - 1], terminal);
    if (terminal) return records;
    nextOffset += offsets.length * pageSize;
  }
}
