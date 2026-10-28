import { formatPace, metersPerBeat, paceSPerKm, round, verticalRatioPct } from "../../core/running";
import type { TileEnvelope } from "./spec";
import { type TileContext, addDays, emptyTile } from "./tiles";

// How the athlete's running economy is trending, on steady runs only: runs on their own (not a class
// or a race) that the watch recorded as one continuous effort, 20 minutes or longer, with no benchmark
// result. Intervals and races mix efforts inside one workout, so their averages don't compare week to week.

const WEEKS = 26;
const MIN_STEADY_S = 20 * 60;
const COMPARE_RUNS = 4;

interface EconomyRun {
  date: string;
  sessionKey: string;
  metersPerBeat: number | null;
  paceSPerKm: number | null;
  groundContactMs: number | null;
  verticalRatioPct: number | null;
  verticalOscillationCm: number | null;
  strideM: number | null;
  powerW: number | null;
}

type MetricKey = Exclude<keyof EconomyRun, "date" | "sessionKey">;

const METRICS: { key: MetricKey; label: string; better: "higher" | "lower" | null; places: number; format: (v: number) => string }[] = [
  { key: "metersPerBeat", label: "Meters per heartbeat", better: "higher", places: 2, format: (v) => v.toFixed(2) },
  { key: "paceSPerKm", label: "Avg pace", better: "lower", places: 0, format: formatPace },
  { key: "groundContactMs", label: "Ground contact", better: "lower", places: 0, format: (v) => `${v} ms` },
  { key: "verticalRatioPct", label: "Vertical ratio", better: "lower", places: 1, format: (v) => `${v.toFixed(1)}%` },
  { key: "verticalOscillationCm", label: "Vertical oscillation", better: "lower", places: 1, format: (v) => `${v.toFixed(1)} cm` },
  { key: "strideM", label: "Stride length", better: null, places: 2, format: (v) => `${v.toFixed(2)} m` },
  { key: "powerW", label: "Power", better: null, places: 0, format: (v) => `${v} W` },
];

const DESCRIPTION =
  `Steady runs from the last ${WEEKS} weeks: runs on your own (not a class or a race) that your watch recorded as one continuous effort, ` +
  "20 minutes or longer, with no time trial. Intervals and races mix efforts in one workout, so they're left out. " +
  "Meters per heartbeat is distance divided by total beats (duration × average heart rate). " +
  `Each trend compares the average of your latest ${COMPARE_RUNS} steady runs with your first ${COMPARE_RUNS} in the window.`;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

interface Row {
  session_key: string;
  local_date: string;
  source_record_id: number;
  natural_key: string;
  segments: number | null;
  type: string;
  value: number;
}

/** One point per steady run, oldest first. Heart rate is the watch's own average for that workout. */
async function steadyRuns(ctx: TileContext, from: string, to: string): Promise<{ runs: EconomyRun[]; recordIds: number[] }> {
  const { results } = await ctx.db
    .prepare(
      `SELECT s.session_key, s.local_date, m.source_record_id, sr.natural_key, json_array_length(sr.payload, '$.segments') AS segments, m.type, m.value
       FROM sessions s
       JOIN measurements m ON m.session_id = s.id AND m.athlete_id = s.athlete_id AND m.generation = s.generation
       JOIN source_records sr ON sr.id = m.source_record_id
       WHERE s.athlete_id = ? AND s.generation = ? AND s.kind = 'run' AND s.local_date BETWEEN ? AND ?
         AND m.type IN ('duration_s', 'distance_m', 'hr_avg', 'run_power_w', 'run_stride_m', 'run_gct_ms', 'run_vo_cm', 'run_speed_mps')
         AND NOT EXISTS (SELECT 1 FROM results r WHERE r.session_id = s.id AND r.generation = s.generation AND r.benchmark IS NOT NULL)
       ORDER BY s.start_utc, s.id, m.start_utc, m.source_record_id`,
    )
    .bind(ctx.athleteId, ctx.generation, from, to)
    .all<Row>();

  const bySession = new Map<string, Row[]>();
  for (const r of results) bySession.set(r.session_key, [...(bySession.get(r.session_key) ?? []), r]);

  const runs: EconomyRun[] = [];
  const recordIds: number[] = [];
  for (const [sessionKey, rows] of bySession) {
    // The first workout that carries running form, as on the session page; its heart rate is the aggregate keyed to it.
    const workout = rows.find((r) => r.type.startsWith("run_"));
    if (!workout || (workout.segments ?? 0) > 1) continue;
    const of = (type: string, key = workout.natural_key) => rows.find((r) => r.natural_key === key && r.type === type)?.value ?? null;
    const durationS = of("duration_s");
    if (durationS == null || durationS < MIN_STEADY_S) continue;
    const distanceM = of("distance_m");
    const hr = of("hr_avg", `hr:${workout.natural_key}`);
    const stride = of("run_stride_m");
    const vo = of("run_vo_cm");
    runs.push({
      date: workout.local_date,
      sessionKey,
      metersPerBeat: distanceM != null && hr != null ? metersPerBeat(distanceM, durationS, hr) : null,
      paceSPerKm: distanceM != null ? paceSPerKm(distanceM, durationS) : null,
      groundContactMs: of("run_gct_ms"),
      verticalRatioPct: vo != null && stride != null ? verticalRatioPct(vo, stride) : null,
      verticalOscillationCm: vo,
      strideM: stride,
      powerW: of("run_power_w"),
    });
    recordIds.push(workout.source_record_id);
  }
  return { runs, recordIds };
}

export async function runningEconomy(ctx: TileContext): Promise<TileEnvelope> {
  const from = addDays(ctx.asOf, -(WEEKS * 7 - 1));
  const { runs, recordIds } = await steadyRuns(ctx, from, ctx.asOf);

  // Each stat compares its own latest and first runs: up to 4 each, never overlapping.
  const metrics = METRICS.flatMap((m) => {
    const series = runs.flatMap((r) => (r[m.key] == null ? [] : [{ date: r.date, sessionKey: r.sessionKey, value: r[m.key] as number }]));
    if (!series.length) return [];
    const compared = Math.min(COMPARE_RUNS, Math.floor(series.length / 2));
    const then = compared ? round(mean(series.slice(0, compared).map((p) => p.value)), m.places) : null;
    const now = round(mean(series.slice(-Math.max(compared, 1)).map((p) => p.value)), m.places);
    return [
      {
        key: m.key,
        label: m.label,
        better: m.better,
        compared,
        now,
        then,
        change: then == null ? null : round(now - then, m.places),
        nowDisplay: m.format(now),
        thenDisplay: then == null ? null : m.format(then),
        series,
      },
    ];
  });
  if (!metrics.length) return emptyTile("running_economy", DESCRIPTION);

  const headline = metrics[0];
  const latest = Math.max(headline.compared, 1);
  const trend = headline.thenDisplay == null ? "" : ` (from ${headline.thenDisplay})`;
  return {
    type: "running_economy",
    value: { from, to: ctx.asOf, runs: runs.length, metrics },
    display: `${headline.nowDisplay}${headline.key === "metersPerBeat" ? " m per beat" : ""}`,
    context: `${runs.length} steady run${runs.length === 1 ? "" : "s"} in ${WEEKS} weeks${headline.compared ? ` · latest ${headline.compared} vs first ${headline.compared}` : ""}`,
    spoken: `On your steady runs since ${runs[0].date}, ${headline.label.toLowerCase()} averaged ${headline.nowDisplay} over your latest ${latest}${trend}.`,
    calc: { description: DESCRIPTION, inputs: { sourceRecordIds: recordIds }, computedAt: new Date().toISOString() },
  };
}
