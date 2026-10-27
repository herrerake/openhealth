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

/** The generation readers should use for this athlete ("" before the first reconcile). */
export async function currentGeneration(db: D1Database, athleteId: string): Promise<string> {
  const row = await db.prepare("SELECT generation FROM reconcile_generations WHERE athlete_id = ?").bind(athleteId).first<{ generation: string }>();
  return row?.generation ?? "";
}

/**
 * Rebuilds the athlete's sessions and derived rows from their source records as a new generation.
 * Rows are written under a fresh generation id (SQLite assigns row ids, so athletes never collide);
 * one atomic batch then points the athlete at it and deletes every other generation. A failure
 * part-way leaves the previous generation current, and the next rebuild sweeps up the partial rows.
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
  const generation = crypto.randomUUID();
  const sessionIdOf = "(SELECT id FROM sessions WHERE athlete_id = ? AND generation = ? AND session_key = ?)";

  const statements: D1PreparedStatement[] = [];
  const sessionKeyByRecord = new Map<number, string>();
  const duplicateIds = new Set(out.duplicates.map((d) => d.duplicate));

  for (const s of out.sessions) {
    statements.push(
      db
        .prepare(
          `INSERT INTO sessions (athlete_id, generation, session_key, local_date, kind, category, start_utc, end_utc, status, flags)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(athleteId, generation, s.key, s.localDate, s.kind, s.category, s.startUtc, s.endUtc, s.status, JSON.stringify(s.flags)),
    );
    for (const src of s.sources) {
      if (src.role !== "duplicate") sessionKeyByRecord.set(src.recordId, s.key);
      statements.push(
        db
          .prepare(`INSERT INTO session_sources (session_id, source_record_id, role) SELECT id, ?, ? FROM sessions WHERE athlete_id = ? AND generation = ? AND session_key = ?`)
          .bind(src.recordId, src.role, athleteId, generation, s.key),
      );
    }
  }

  const duplicateWorkoutKeys = new Set(records.filter((r) => duplicateIds.has(r.id)).map((r) => r.naturalKey));
  for (const rec of records) {
    if (duplicateIds.has(rec.id)) continue;
    if (rec.kind === "hr_aggregate" && duplicateWorkoutKeys.has((rec.payload as { workoutKey?: string } | null)?.workoutKey ?? "")) continue;
    const key = sessionKeyByRecord.get(rec.id) ?? null;
    const sessionBinds = [athleteId, generation, key];
    const n = normalize(rec);
    for (const r of n.results) {
      statements.push(
        db
          .prepare(
            `INSERT INTO results (athlete_id, generation, session_id, source_record_id, benchmark, movement, scaling, metric, value, unit, local_date)
             VALUES (?, ?, ${sessionIdOf}, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(athleteId, generation, ...sessionBinds, rec.id, r.benchmark, r.movement, r.scaling, r.metric, r.value, r.unit, r.localDate),
      );
    }
    for (const m of n.measurements) {
      statements.push(
        db
          .prepare(
            `INSERT INTO measurements (athlete_id, generation, session_id, source_record_id, type, value, unit, start_utc, end_utc, local_date)
             VALUES (?, ?, ${sessionIdOf}, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(athleteId, generation, ...sessionBinds, rec.id, m.type, m.value, m.unit, m.startUtc, m.endUtc, m.localDate),
      );
    }
    for (const note of n.notes) {
      statements.push(
        db
          .prepare(`INSERT INTO notes (athlete_id, generation, session_id, source_record_id, local_date, text) VALUES (?, ?, ${sessionIdOf}, ?, ?, ?)`)
          .bind(athleteId, generation, ...sessionBinds, rec.id, note.localDate, note.text),
      );
    }
  }

  for (const c of out.conflicts) {
    statements.push(
      db
        .prepare(
          `INSERT INTO conflicts (athlete_id, generation, session_id, field, values_json, chosen, resolved_by) VALUES (?, ?, ${sessionIdOf}, ?, ?, ?, ?)`,
        )
        .bind(athleteId, generation, athleteId, generation, c.sessionKey, c.field, JSON.stringify(c.values), c.chosen, c.resolvedBy),
    );
  }

  await runBatches(db, statements);

  // One atomic batch: point at the new generation and drop every other one.
  await db.batch([
    db
      .prepare(
        `INSERT INTO reconcile_generations (athlete_id, generation, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (athlete_id) DO UPDATE SET generation = excluded.generation, updated_at = excluded.updated_at`,
      )
      .bind(athleteId, generation, new Date().toISOString()),
    db
      .prepare("DELETE FROM session_sources WHERE session_id IN (SELECT id FROM sessions WHERE athlete_id = ? AND generation <> ?)")
      .bind(athleteId, generation),
    db.prepare("DELETE FROM sessions WHERE athlete_id = ? AND generation <> ?").bind(athleteId, generation),
    ...DERIVED_TABLES.map((t) => db.prepare(`DELETE FROM ${t} WHERE athlete_id = ? AND generation <> ?`).bind(athleteId, generation)),
  ]);

  return {
    sessions: out.sessions.length,
    needsReview: out.sessions.filter((s) => s.status === "review_required").length,
    duplicatesRemoved: out.duplicates.length,
    durationMs: Date.now() - started,
  };
}
