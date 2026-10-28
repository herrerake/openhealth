import { toIsoUtc, zonedWallToUtc } from "../core/time";
import type { SourceBatch, SourceRecordInput } from "../core/types";
import type { SyncContext } from "./types";

// HYROX has no public API. The shape copies what results.hyrox.com (mika:timing) shows a
// finisher: overall time and ranks, then 16 splits in race order plus Roxzone, run total and
// best lap (D-036). `waveStart` is an assumption: site-local wall time, like Mindbody.

/** "01:14:32" → 4472. */
export function hmsToSeconds(hms: string): number {
  const [h, m, s] = hms.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

/** A HYROX result as a source record, spanning the race from the wave start to the finish. */
export function hyroxRecord(r: any, siteTz: string): SourceRecordInput {
  const startUtc = r.waveStart ? zonedWallToUtc(r.waveStart, siteTz) : null;
  const total = r.overall?.time ? hmsToSeconds(r.overall.time) : null;
  return {
    source: "hyrox",
    kind: "race_result",
    naturalKey: `race:${r.id}`,
    payload: r,
    startUtc,
    endUtc: startUtc && total != null ? toIsoUtc(Date.parse(startUtc) + total * 1000) : startUtc,
    localDate: r.event?.date ?? null,
    tz: siteTz,
  };
}

/** GET /api/athletes/{id}/results: every result for one athlete, newest first. */
export async function* syncHyrox(ctx: SyncContext): AsyncIterable<SourceBatch> {
  const url = `${ctx.baseUrl}/api/athletes/${ctx.credentials.externalId}/results`;
  const res = await ctx.fetch(url, { headers: { authorization: `Bearer ${ctx.credentials.token}`, accept: "application/json" } });
  if (!res.ok) throw new Error(`hyrox: HTTP ${res.status} from results`);
  const { results } = await res.json<{ results: any[] }>();
  yield {
    records: results.map((r) => hyroxRecord(r, ctx.siteTz)),
    progress: { label: `HYROX · ${results.length} races`, done: results.length, total: results.length },
  };
}
