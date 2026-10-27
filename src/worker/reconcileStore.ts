import { normalize } from "../core/normalize";
import { reconcile } from "../core/reconcile";
import type { Decision } from "../core/types";
import { loadSourceRecords, runBatches } from "./store";

const DERIVED_TABLES = ["results", "measurements", "notes", "conflicts"] as const;

export interface ReconcileSummary {
  sessions: number;
  needsReview: number;
  duplicatesRemoved: number;
  durationMs: number;
}

async function maxId(db: D1Database, table: string): Promise<number> {
  return (await db.prepare(`SELECT coalesce(max(id), 0) AS m FROM ${table}`).first<{ m: number }>())!.m;
}

/**
 * Rebuilds the athlete's sessions and derived rows from their source records.
 * New rows are written first with fresh ids; old rows are removed by id range afterwards,
 * so a failure part-way leaves the previous reconciliation in place.
 */
export async function runReconcile(db: D1Database, athleteId: string, siteTz: string): Promise<ReconcileSummary> {
  const started = Date.now();
  const records = await loadSourceRecords(db, athleteId);
  const { results: decisionRows } = await db
    .prepare("SELECT scope_key, action, payload FROM decisions WHERE athlete_id = ? ORDER BY id")
    .bind(athleteId)
    .all<{ scope_key: string; action: Decision["action"]; payload: string }>();
  const decisions: Decision[] = decisionRows.map((d) => ({ scopeKey: d.scope_key, action: d.action, payload: JSON.parse(d.payload) }));

  const out = reconcile({ records, decisions, siteTz });

  const oldMax = {
    sessions: await maxId(db, "sessions"),
    ...Object.fromEntries(await Promise.all(DERIVED_TABLES.map(async (t) => [t, await maxId(db, t)] as const))),
  } as Record<"sessions" | (typeof DERIVED_TABLES)[number], number>;

  const statements: D1PreparedStatement[] = [];
  const sessionIdByKey = new Map<string, number>();
  const sessionIdByRecord = new Map<number, number>();
  const duplicateIds = new Set(out.duplicates.map((d) => d.duplicate));

  out.sessions.forEach((s, i) => {
    const id = oldMax.sessions + i + 1;
    sessionIdByKey.set(s.key, id);
    statements.push(
      db
        .prepare(
          `INSERT INTO sessions (id, athlete_id, session_key, local_date, kind, category, start_utc, end_utc, status, flags)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, athleteId, s.key, s.localDate, s.kind, s.category, s.startUtc, s.endUtc, s.status, JSON.stringify(s.flags)),
    );
    for (const src of s.sources) {
      if (src.role !== "duplicate") sessionIdByRecord.set(src.recordId, id);
      statements.push(
        db.prepare("INSERT INTO session_sources (session_id, source_record_id, role) VALUES (?, ?, ?)").bind(id, src.recordId, src.role),
      );
    }
  });

  const duplicateWorkoutKeys = new Set(records.filter((r) => duplicateIds.has(r.id)).map((r) => r.naturalKey));
  for (const rec of records) {
    if (duplicateIds.has(rec.id)) continue;
    if (rec.kind === "hr_aggregate" && duplicateWorkoutKeys.has((rec.payload as { workoutKey: string }).workoutKey)) continue;
    const sessionId = sessionIdByRecord.get(rec.id) ?? null;
    const n = normalize(rec);
    for (const r of n.results) {
      statements.push(
        db
          .prepare(
            `INSERT INTO results (athlete_id, session_id, source_record_id, benchmark, movement, scaling, metric, value, unit, local_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(athleteId, sessionId, rec.id, r.benchmark, r.movement, r.scaling, r.metric, r.value, r.unit, r.localDate),
      );
    }
    for (const m of n.measurements) {
      statements.push(
        db
          .prepare(
            `INSERT INTO measurements (athlete_id, session_id, source_record_id, type, value, unit, start_utc, end_utc, local_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(athleteId, sessionId, rec.id, m.type, m.value, m.unit, m.startUtc, m.endUtc, m.localDate),
      );
    }
    for (const note of n.notes) {
      statements.push(
        db
          .prepare("INSERT INTO notes (athlete_id, session_id, source_record_id, local_date, text) VALUES (?, ?, ?, ?, ?)")
          .bind(athleteId, sessionId, rec.id, note.localDate, note.text),
      );
    }
  }

  for (const c of out.conflicts) {
    statements.push(
      db
        .prepare("INSERT INTO conflicts (athlete_id, session_id, field, values_json, chosen, resolved_by) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(athleteId, sessionIdByKey.get(c.sessionKey), c.field, JSON.stringify(c.values), c.chosen, c.resolvedBy),
    );
  }

  await runBatches(db, statements);
  await db.batch([
    db
      .prepare("DELETE FROM session_sources WHERE session_id IN (SELECT id FROM sessions WHERE athlete_id = ? AND id <= ?)")
      .bind(athleteId, oldMax.sessions),
    db.prepare("DELETE FROM sessions WHERE athlete_id = ? AND id <= ?").bind(athleteId, oldMax.sessions),
    ...DERIVED_TABLES.map((t) => db.prepare(`DELETE FROM ${t} WHERE athlete_id = ? AND id <= ?`).bind(athleteId, oldMax[t])),
  ]);

  return {
    sessions: out.sessions.length,
    needsReview: out.sessions.filter((s) => s.status === "review_required").length,
    duplicatesRemoved: out.duplicates.length,
    durationMs: Date.now() - started,
  };
}
