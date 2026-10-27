// Pagination exactly as the real providers do it, over fixture arrays.
// Pure functions: no Workers APIs, so Node tests can validate the shapes.

type Status = 200 | 400;

/** WodUp: newest-first array, `limit` 1–100 (default 10), `after_cursor` = last id seen. */
export function paginateWodup(all: { id: string }[], q: { limit?: number; after_cursor?: string }): { status: Status; body: unknown } {
  const limit = q.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { status: 400, body: { errors: [{ detail: "limit must be between 1 and 100", source: { parameter: "limit" } }] } };
  }
  let start = 0;
  if (q.after_cursor) {
    const idx = all.findIndex((x) => x.id === q.after_cursor);
    if (idx === -1) return { status: 400, body: { errors: [{ detail: "unknown cursor", source: { parameter: "after_cursor" } }] } };
    start = idx + 1;
  }
  return { status: 200, body: all.slice(start, start + limit) };
}

export interface MindbodyPage<V> {
  PaginationResponse: { RequestedLimit: number; RequestedOffset: number; PageSize: number; TotalResults: number };
  Visits: V[];
}

const nextDay = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Mindbody: `limit` ≤ 200 (default 100), `offset`, optional inclusive local-date range on StartDateTime. */
export function paginateMindbody<V extends { StartDateTime: string }>(
  all: V[],
  q: { limit?: number; offset?: number; startDate?: string; endDate?: string },
): { status: Status; body: MindbodyPage<V> } {
  const limit = q.limit ?? 100;
  const offset = q.offset ?? 0;
  const empty = { PaginationResponse: { RequestedLimit: limit, RequestedOffset: offset, PageSize: 0, TotalResults: 0 }, Visits: [] };
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) {
    return { status: 400, body: empty };
  }
  const filtered = all.filter(
    (v) => (!q.startDate || v.StartDateTime >= q.startDate) && (!q.endDate || v.StartDateTime < nextDay(q.endDate)),
  );
  const page = filtered.slice(offset, offset + limit);
  return {
    status: 200,
    body: {
      PaginationResponse: { RequestedLimit: limit, RequestedOffset: offset, PageSize: page.length, TotalResults: filtered.length },
      Visits: page,
    },
  };
}
