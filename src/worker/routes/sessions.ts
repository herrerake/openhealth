import { Hono } from "hono";
import { formatTime } from "../../core/format";
import {
  type HrPoint,
  type TimelineBlock,
  type TimelineMethod,
  blocksFromStarts,
  findCandidates,
  hrStats,
  matchByDuration,
  plannedBlocks,
  raceBlocks,
  segmentBlocks,
  spokenSummary,
} from "../../core/timeline";
import { formatResult } from "../dashboard/tiles";
import type { AppEnv } from "../env";
import { currentGeneration } from "../reconcileStore";
import { requireAthlete } from "../session";
import { aiMatch } from "../timeline/aiMatch";

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
    case "race_result":
      return `HYROX result · ${p.event?.name ?? "Race"} · ${p.overall?.time ?? ""} · ${p.overall?.rankAgeGroup ?? "?"} of ${p.overall?.finishers?.ageGroup ?? "?"} in ${p.participant?.ageGroup ?? "age group"}`;
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

const seconds = (fromUtc: string, toUtc: string) => (Date.parse(toUtc) - Date.parse(fromUtc)) / 1000;

/**
 * The session timeline (D-038): heart rate across the workout with its blocks laid over it.
 * Block edges come from the official race splits, the watch's segments, or (for classes) a match
 * of the WodUp blocks to boundaries found in the heart rate, labeled as estimates.
 */
sessions.get("/api/sessions/:sessionKey/timeline", requireAthlete, async (c) => {
  const athleteId = c.var.athleteId;
  const generation = await currentGeneration(c.env.DB, athleteId);
  const session = await c.env.DB.prepare(
    `SELECT id, session_key, local_date, kind, start_utc, end_utc FROM sessions WHERE athlete_id = ? AND generation = ? AND session_key = ?`,
  )
    .bind(athleteId, generation, c.req.param("sessionKey"))
    .first<{ id: number; session_key: string; local_date: string; kind: string; start_utc: string; end_utc: string }>();
  if (!session) return c.json({ error: "not_found" }, 404);
  const athlete = await c.env.DB.prepare("SELECT tz FROM athletes WHERE id = ?").bind(athleteId).first<{ tz: string }>();

  const { results: sources } = await c.env.DB.prepare(
    `SELECT sr.kind, sr.natural_key, sr.payload, sr.start_utc, sr.end_utc FROM session_sources ss JOIN source_records sr ON sr.id = ss.source_record_id
     WHERE ss.session_id = ? AND ss.role <> 'duplicate' ORDER BY sr.start_utc, sr.id`,
  )
    .bind(session.id)
    .all<{ kind: string; natural_key: string; payload: string; start_utc: string | null; end_utc: string | null }>();
  const of = (kind: string) => sources.filter((s) => s.kind === kind);
  const json = (s: { payload: string }) => JSON.parse(s.payload);
  const visit = of("visit")[0];
  const race = of("race_result")[0];
  const training = of("training_session")[0];
  const resultsById = new Map(of("result").map((r) => [json(r).id, json(r)]));
  const ordered = training ? ((json(training).resultIds as string[]) ?? []).map((id) => resultsById.get(id)).filter(Boolean) : [];
  const workout = of("workout")[0];

  const title = race
    ? `HYROX ${json(race).event?.name ?? ""}`.trim()
    : visit
      ? json(visit).Name
      : session.kind === "open_gym"
        ? "Open gym"
        : session.kind === "run"
          ? "Run"
          : "Workout";
  const base = { sessionKey: session.session_key, localDate: session.local_date, kind: session.kind, title, tz: athlete?.tz ?? c.env.SITE_TZ };

  if (!workout) {
    // No watch workout (the watch died): the plan is known, the timing isn't.
    const planned = plannedBlocks(ordered);
    return c.json({
      ...base,
      startUtc: session.start_utc,
      method: "none" satisfies TimelineMethod,
      hr: null,
      blocks: planned.map((p) => ({ label: p.label, prescription: p.prescription, startS: null, endS: null, source: "estimated", avgHr: null, maxHr: null })),
      summary: null,
      spoken: "No heart rate was recorded for this session.",
    });
  }

  const startUtc = workout.start_utc!;
  const totalS = seconds(startUtc, workout.end_utc!);
  const series = await c.env.DB.prepare("SELECT payload FROM source_records WHERE athlete_id = ? AND natural_key = ?")
    .bind(athleteId, `hrs:${workout.natural_key}`)
    .first<{ payload: string }>();
  const hr = series ? (JSON.parse(series.payload) as { stepS: number; points: HrPoint[] }) : null;
  const points = hr?.points ?? [];
  const segments = ((json(workout).segments ?? []) as { startUtc: string; seconds: number }[]).map((s) => ({ offsetS: seconds(startUtc, s.startUtc), seconds: s.seconds }));

  let method: TimelineMethod = "none";
  let blocks: TimelineBlock[] = [];
  if (race?.start_utc) {
    method = "hyrox_splits";
    blocks = raceBlocks(json(race), seconds(startUtc, race.start_utc), points);
  } else if (segments.length > 1) {
    method = "watch_segments";
    const work = ordered.find((r: any) => r.type !== "WarmUpResult");
    const workName = work?.type === "CardioIntervalsResult" ? "Rep" : (work?.prescribed_workout?.name ?? "Run");
    blocks = segmentBlocks(segments, points, workName, ordered.some((r: any) => r.type === "WarmUpResult"));
  } else if (ordered.length > 1 && hr) {
    const planned = plannedBlocks(ordered);
    const candidates = findCandidates(points, hr.stepS, totalS);
    const byId = new Map(candidates.map((x) => [x.id, x.offsetS]));
    const ai = await aiMatch(c.env, `${athleteId}/${encodeURIComponent(workout.natural_key)}`, planned, candidates, totalS);
    const starts = ai ?? matchByDuration(planned, candidates, totalS);
    if (starts.length === planned.length - 1) {
      method = ai ? "ai_match" : "duration_match";
      blocks = blocksFromStarts(planned, starts.map((id) => byId.get(id)!), totalS, points, "estimated");
    }
  }
  if (!blocks.length) {
    const label = ordered.length === 1 ? plannedBlocks(ordered)[0].label : title;
    blocks = [{ label, prescription: null, startS: 0, endS: Math.round(totalS), source: "watch", ...hrStats(points, 0, totalS) }];
  }

  const whole = hrStats(points, 0, totalS);
  return c.json({
    ...base,
    startUtc,
    method,
    hr,
    blocks,
    summary: { minutes: Math.round(totalS / 60), ...whole },
    spoken: spokenSummary(blocks, method),
  });
});
