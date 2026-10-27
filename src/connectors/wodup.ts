import { normalizeWodupUtc, utcToLocalDate } from "../core/time";
import type { SourceBatch, SourceRecordInput } from "../core/types";
import type { SyncContext } from "./types";

const PAGE_SIZE = 100;

/** Walks GET /api/public/athletes/{id}/training_sessions with cursor pagination (newest first). */
export async function* syncWodup(ctx: SyncContext): AsyncIterable<SourceBatch> {
  const auth = `Basic ${btoa(`${ctx.credentials.token}:`)}`;
  let cursor: string | undefined;
  let done = 0;
  for (;;) {
    const url = new URL(`${ctx.baseUrl}/api/public/athletes/${ctx.credentials.externalId}/training_sessions`);
    url.searchParams.set("limit", String(PAGE_SIZE));
    if (cursor) url.searchParams.set("after_cursor", cursor);
    const res = await ctx.fetch(url, { headers: { authorization: auth, accept: "application/json" } });
    if (!res.ok) throw new Error(`wodup: HTTP ${res.status} from training_sessions`);
    const page = await res.json<any[]>();
    if (!page.length) return;

    const records: SourceRecordInput[] = [];
    for (const s of page) {
      const times = s.results.map((r: any) => normalizeWodupUtc(r.done_at)).sort();
      const localDate = s.wod?.occurs_on ?? (times[0] ? utcToLocalDate(times[0], ctx.siteTz) : null);
      records.push({
        source: "wodup",
        kind: "training_session",
        naturalKey: `session:${s.id}`,
        payload: { id: s.id, wod: s.wod, competition: s.competition, resultIds: s.results.map((r: any) => r.id) },
        startUtc: times[0] ?? null,
        endUtc: times.at(-1) ?? null,
        localDate,
        tz: null,
      });
      for (const r of s.results) {
        records.push({
          source: "wodup",
          kind: "result",
          naturalKey: `result:${r.id}`,
          payload: { ...r, sessionId: s.id },
          startUtc: normalizeWodupUtc(r.done_at),
          endUtc: null,
          localDate,
          tz: null,
        });
      }
    }
    done += page.length;
    yield { records, progress: { label: `WodUp · ${done} sessions`, done } };
    if (page.length < PAGE_SIZE) return;
    cursor = page.at(-1).id;
  }
}
