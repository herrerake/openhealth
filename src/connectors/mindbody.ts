import { zonedWallToUtc } from "../core/time";
import type { SourceBatch, SourceRecordInput } from "../core/types";
import type { SyncContext } from "./types";

const PAGE_SIZE = 200;

/** A Mindbody visit as a source record; its wall-clock times are converted with the site zone. */
export function mindbodyRecord(v: any, siteTz: string): SourceRecordInput {
  return {
    source: "mindbody",
    kind: "visit",
    naturalKey: `visit:${v.Id}`,
    payload: v,
    startUtc: zonedWallToUtc(v.StartDateTime, siteTz),
    endUtc: zonedWallToUtc(v.EndDateTime, siteTz),
    localDate: String(v.StartDateTime).slice(0, 10),
    tz: siteTz,
  };
}
const HISTORY_START = "2015-01-01";

/** Walks GET /public/v6/client/clientvisits with offset pagination. Times are site-local wall time. */
export async function* syncMindbody(ctx: SyncContext): AsyncIterable<SourceBatch> {
  const today = new Date().toISOString().slice(0, 10);
  let offset = 0;
  for (;;) {
    const url = new URL(`${ctx.baseUrl}/public/v6/client/clientvisits`);
    url.searchParams.set("request.clientId", ctx.credentials.externalId);
    url.searchParams.set("request.startDate", HISTORY_START);
    url.searchParams.set("request.endDate", today);
    url.searchParams.set("request.limit", String(PAGE_SIZE));
    url.searchParams.set("request.offset", String(offset));
    const res = await ctx.fetch(url, {
      headers: { "api-key": "openhealth-demo", siteid: "-99", authorization: ctx.credentials.token, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`mindbody: HTTP ${res.status} from clientvisits`);
    const { PaginationResponse: page, Visits } = await res.json<any>();
    const records = Visits.map((v: any) => mindbodyRecord(v, ctx.siteTz));
    offset += Visits.length;
    yield { records, progress: { label: `Mindbody · ${offset} class visits`, done: offset, total: page.TotalResults } };
    if (!Visits.length || offset >= page.TotalResults) return;
  }
}
