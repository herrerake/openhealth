import { Hono } from "hono";
import { formatTime } from "../../core/format";
import { formatResult } from "../dashboard/tiles";
import type { AppEnv } from "../env";
import { currentGeneration } from "../reconcileStore";
import { requireAthlete } from "../session";

const ACTIVITY: Record<string, string> = {
  HKWorkoutActivityTypeRunning: "run",
  HKWorkoutActivityTypeRowing: "rowing",
  HKWorkoutActivityTypeFunctionalStrengthTraining: "strength training",
  HKWorkoutActivityTypeHighIntensityIntervalTraining: "HIIT",
  HKWorkoutActivityTypeCrossTraining: "cross training",
};

interface SourceRow {
  id: number;
  source: string;
  kind: string;
  natural_key: string;
  payload: string | null;
  start_utc: string | null;
  end_utc: string | null;
  role: string;
}

/** One human line per source record, so the athlete can see what each app contributed. */
function summarize(r: SourceRow, resultLine: string | undefined): string {
  const p = r.payload ? JSON.parse(r.payload) : {};
  switch (r.kind) {
    case "visit":
      return `Mindbody visit · ${p.Name ?? "Class"} ${String(p.StartDateTime ?? "").slice(11, 16)}${p.SignedIn ? " · checked in" : ""}`;
    case "workout": {
      const who = /Apple Watch$/.test(p.sourceName ?? "") ? "Apple Watch" : (p.sourceName ?? "Health");
      const minutes = r.start_utc && r.end_utc ? Math.round((Date.parse(r.end_utc) - Date.parse(r.start_utc)) / 60_000) : null;
      const km = p.totals?.distance_m != null ? ` · ${(p.totals.distance_m / 1000).toFixed(2)} km` : "";
      return `${who} workout · ${ACTIVITY[p.workoutActivityType] ?? "workout"}${minutes != null ? ` · ${minutes} min` : ""}${km}`;
    }
    case "hr_aggregate":
      return `Heart rate · avg ${p.avg} bpm, max ${p.max} bpm (${p.samples} readings${p.gapsOver5Min ? `, ${p.gapsOver5Min} gap` : ""})`;
    case "training_session":
      return `WodUp session · ${p.wod?.name ?? "Logged without a programmed WOD"}`;
    case "result":
      return `WodUp result · ${resultLine ?? p.type}${p.notes ? ` · “${p.notes}”` : ""}`;
    default:
      return `${r.source} ${r.kind}`;
  }
}

export const sessions = new Hono<AppEnv>();

sessions.get("/api/sessions/:sessionKey", requireAthlete, async (c) => {
  const athleteId = c.var.athleteId;
  const generation = await currentGeneration(c.env.DB, athleteId);
  const session = await c.env.DB.prepare(
    `SELECT id, session_key, local_date, kind, category, start_utc, end_utc, status, flags FROM sessions
     WHERE athlete_id = ? AND generation = ? AND session_key = ?`,
  )
    .bind(athleteId, generation, c.req.param("sessionKey"))
    .first<{ id: number; session_key: string; local_date: string; kind: string; category: string; start_utc: string; end_utc: string; status: string; flags: string }>();
  if (!session) return c.json({ error: "not_found" }, 404);

  const [sources, results, measurements, notes, conflicts] = await Promise.all([
    c.env.DB.prepare(
      `SELECT sr.id, sr.source, sr.kind, sr.natural_key, sr.payload, sr.start_utc, sr.end_utc, ss.role
       FROM session_sources ss JOIN source_records sr ON sr.id = ss.source_record_id WHERE ss.session_id = ? ORDER BY sr.id`,
    )
      .bind(session.id)
      .all<SourceRow>(),
    c.env.DB.prepare("SELECT source_record_id, benchmark, movement, scaling, metric, value, unit FROM results WHERE session_id = ? ORDER BY source_record_id")
      .bind(session.id)
      .all<{ source_record_id: number; benchmark: string | null; movement: string; scaling: string; metric: string; value: number; unit: string }>(),
    c.env.DB.prepare("SELECT type, value, unit FROM measurements WHERE session_id = ?").bind(session.id).all(),
    c.env.DB.prepare("SELECT local_date, text FROM notes WHERE session_id = ?").bind(session.id).all(),
    c.env.DB.prepare("SELECT field, values_json, chosen, resolved_by FROM conflicts WHERE session_id = ? ORDER BY field")
      .bind(session.id)
      .all<{ field: string; values_json: string; chosen: string; resolved_by: string }>(),
  ]);

  const resultLines = new Map(results.results.map((r) => [r.source_record_id, formatResult(r)]));
  return c.json({
    session: { ...session, flags: JSON.parse(session.flags) },
    sources: sources.results.map((r) => ({
      id: r.id,
      source: r.source,
      kind: r.kind,
      naturalKey: r.natural_key,
      role: r.role,
      summary: summarize(r, resultLines.get(r.id)),
    })),
    results: results.results,
    measurements: measurements.results,
    notes: notes.results,
    conflicts: conflicts.results.map((x) => ({
      field: x.field,
      values: JSON.parse(x.values_json),
      display: Object.fromEntries(
        Object.entries(JSON.parse(x.values_json) as Record<string, number>).map(([k, v]) => [
          k,
          x.field === "distance_m" ? `${Math.round(v).toLocaleString("en-US")} m` : formatTime(v),
        ]),
      ),
      chosen: x.chosen,
      resolvedBy: x.resolved_by,
    })),
  });
});
