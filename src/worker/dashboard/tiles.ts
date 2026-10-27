import { formatLoad, formatPercent, formatTime } from "../../core/format";
import type { TileEnvelope, TileType } from "./spec";

// Every tile is computed from the athlete's current reconcile generation, as of one local day,
// and says how it was calculated. SQL does the filtering; JS only buckets and formats.

export interface TileContext {
  db: D1Database;
  athleteId: string;
  asOf: string;
  tz: string;
  generation: string;
}

type Calc = TileEnvelope["calc"];

const DAY_MS = 86_400_000;
const STREAK_THRESHOLD = 4;
const RECENT_LIMIT = 5;
const MIX_DAYS = 56;
const CATEGORIES = ["strength", "metcon", "run", "row", "mixed"] as const;

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return addDays(date, -((d.getUTCDay() + 6) % 7));
}

const calc = (description: string, inputs: Calc["inputs"] = {}): Calc => ({ description, inputs, computedAt: new Date().toISOString() });

export function emptyTile(type: TileType, description: string): TileEnvelope {
  return { type, value: null, display: "No data yet", context: "", calc: calc(description) };
}

async function sessionDates(ctx: TileContext, from: string, to: string): Promise<string[]> {
  const { results } = await ctx.db
    .prepare("SELECT local_date FROM sessions WHERE athlete_id = ? AND generation = ? AND local_date BETWEEN ? AND ?")
    .bind(ctx.athleteId, ctx.generation, from, to)
    .all<{ local_date: string }>();
  return results.map((r) => r.local_date);
}

export async function hasSessions(ctx: TileContext): Promise<boolean> {
  const row = await ctx.db
    .prepare("SELECT 1 AS x FROM sessions WHERE athlete_id = ? AND generation = ? LIMIT 1")
    .bind(ctx.athleteId, ctx.generation)
    .first();
  return !!row;
}

function weekCounts(dates: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(mondayOf(d), (counts.get(mondayOf(d)) ?? 0) + 1);
  return counts;
}

async function weekSessions(ctx: TileContext): Promise<TileEnvelope> {
  const description =
    "Workouts in the current Monday–Sunday week, after matching all your sources into one history. Your typical week is the average of the 12 weeks before it.";
  if (!(await hasSessions(ctx))) return emptyTile("week_sessions", description);
  const monday = mondayOf(ctx.asOf);
  const counts = weekCounts(await sessionDates(ctx, addDays(monday, -84), addDays(monday, 6)));
  const value = counts.get(monday) ?? 0;
  const typical = Array.from({ length: 12 }, (_, i) => counts.get(addDays(monday, -7 * (i + 1))) ?? 0).reduce((a, b) => a + b, 0) / 12;
  return {
    type: "week_sessions",
    value,
    display: `${value} session${value === 1 ? "" : "s"}`,
    context: `your typical week: ${typical.toFixed(1)}`,
    calc: calc(description, { query: `sessions with local_date in ${monday}…${addDays(monday, 6)}` }),
  };
}

async function streak(ctx: TileContext): Promise<TileEnvelope> {
  const description = `Consecutive weeks with ${STREAK_THRESHOLD} or more workouts. This week counts once it reaches ${STREAK_THRESHOLD}.`;
  if (!(await hasSessions(ctx))) return emptyTile("streak", description);
  const counts = weekCounts(await sessionDates(ctx, "0000-01-01", ctx.asOf));
  const first = [...counts.keys()].sort()[0];
  const weeks: number[] = [];
  for (let w = first; w <= mondayOf(ctx.asOf); w = addDays(w, 7)) weeks.push(counts.get(w) ?? 0);

  let longest = 0;
  let run = 0;
  for (const c of weeks) {
    run = c >= STREAK_THRESHOLD ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let i = weeks.length - 1;
  if (weeks[i] < STREAK_THRESHOLD) i--; // the current week only counts once it qualifies
  let current = 0;
  for (; i >= 0 && weeks[i] >= STREAK_THRESHOLD; i--) current++;
  return {
    type: "streak",
    value: current,
    display: `${current} week${current === 1 ? "" : "s"}`,
    context: `${STREAK_THRESHOLD}+ sessions/week · longest: ${longest}`,
    calc: calc(description, { query: `weekly workout counts from ${first} to ${ctx.asOf}` }),
  };
}

const ACTIVITY_LABEL: Record<string, string> = {
  HKWorkoutActivityTypeRunning: "Run",
  HKWorkoutActivityTypeRowing: "Row",
  HKWorkoutActivityTypeFunctionalStrengthTraining: "Strength training",
  HKWorkoutActivityTypeTraditionalStrengthTraining: "Strength training",
  HKWorkoutActivityTypeHighIntensityIntervalTraining: "HIIT",
  HKWorkoutActivityTypeCrossTraining: "Cross training",
};

function localTime(utc: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(utc));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return `${hour}:${parts.find((p) => p.type === "minute")?.value ?? "00"}`;
}

interface ResultRow {
  session_id: number;
  benchmark: string | null;
  movement: string;
  scaling: string;
  metric: string;
  value: number;
}

export function formatResult(r: Omit<ResultRow, "session_id">): string {
  switch (r.benchmark) {
    case "fran":
      return `Fran ${formatTime(r.value)} ${r.scaling}`;
    case "row_2k":
      return `2k row ${formatTime(r.value)}`;
    case "back_squat_5x5":
      return `Back squat 5x5 @${r.value}`;
    case "deadlift_1rm":
      return `Deadlift ${r.value}`;
  }
  if (r.metric === "load_lbs") return `${r.movement} @${r.value}`;
  if (r.metric === "time_s") return `${r.movement} ${formatTime(r.value)}`;
  if (r.metric === "rounds") return `${r.movement} · ${r.value} rounds`;
  return `${r.movement} ${Math.round(r.value)} m`;
}

const inList = (n: number) => Array.from({ length: n }, () => "?").join(",");

async function recentSessions(ctx: TileContext): Promise<TileEnvelope> {
  const description = "Your five latest workouts, each one merged from every source that recorded it.";
  const { results: sessions } = await ctx.db
    .prepare(
      `SELECT id, session_key, local_date, kind, start_utc FROM sessions
       WHERE athlete_id = ? AND generation = ? AND local_date <= ? ORDER BY start_utc DESC, id DESC LIMIT ?`,
    )
    .bind(ctx.athleteId, ctx.generation, ctx.asOf, RECENT_LIMIT)
    .all<{ id: number; session_key: string; local_date: string; kind: string; start_utc: string | null }>();
  if (!sessions.length) return emptyTile("recent_sessions", description);
  const ids = sessions.map((s) => s.id);

  const [results, measurements, sources] = await Promise.all([
    ctx.db
      .prepare(`SELECT session_id, benchmark, movement, scaling, metric, value FROM results WHERE session_id IN (${inList(ids.length)}) ORDER BY source_record_id`)
      .bind(...ids)
      .all<ResultRow>(),
    ctx.db
      .prepare(`SELECT session_id, type, value FROM measurements WHERE session_id IN (${inList(ids.length)}) AND type IN ('hr_avg', 'active_kcal', 'distance_m')`)
      .bind(...ids)
      .all<{ session_id: number; type: string; value: number }>(),
    ctx.db
      .prepare(
        `SELECT ss.session_id, sr.id, sr.source, sr.kind, sr.payload FROM session_sources ss JOIN source_records sr ON sr.id = ss.source_record_id
         WHERE ss.session_id IN (${inList(ids.length)}) AND ss.role <> 'duplicate'`,
      )
      .bind(...ids)
      .all<{ session_id: number; id: number; source: string; kind: string; payload: string }>(),
  ]);

  const value = sessions.map((s) => {
    const mine = sources.results.filter((x) => x.session_id === s.id);
    const visit = mine.find((x) => x.kind === "visit");
    const workout = mine.find((x) => x.kind === "workout");
    const activity = workout ? (ACTIVITY_LABEL[JSON.parse(workout.payload).workoutActivityType] ?? "Workout") : "Workout";
    const time = s.start_utc ? localTime(s.start_utc, ctx.tz) : "";
    const title =
      s.kind === "class" ? `${visit ? JSON.parse(visit.payload).Name : "Class"} ${time}`.trim()
      : s.kind === "open_gym" ? `Open gym ${time}`.trim()
      : s.kind === "run" ? "Run"
      : activity;
    const m = (type: string) => measurements.results.find((x) => x.session_id === s.id && x.type === type)?.value ?? null;
    const first = results.results.find((r) => r.session_id === s.id);
    const distance = m("distance_m");
    const primary = first ? formatResult(first) : distance != null ? `${activity} ${(distance / 1000).toFixed(1)} km` : activity;
    return {
      sessionKey: s.session_key,
      localDate: s.local_date,
      title,
      primary,
      hrAvg: m("hr_avg"),
      kcal: m("active_kcal"),
      sources: [...new Set(mine.map((x) => x.source))].sort(),
    };
  });
  return {
    type: "recent_sessions",
    value,
    display: `${value.length} recent sessions`,
    context: "",
    calc: calc(description, { sourceRecordIds: sources.results.map((x) => x.id) }),
  };
}

async function trainingMix(ctx: TileContext): Promise<TileEnvelope> {
  const description = "Share of your training minutes by type over the last 8 weeks. Each workout's type comes from its first logged result.";
  if (!(await hasSessions(ctx))) return emptyTile("training_mix", description);
  const { results } = await ctx.db
    .prepare(
      `SELECT category, start_utc, end_utc FROM sessions
       WHERE athlete_id = ? AND generation = ? AND local_date BETWEEN ? AND ? AND start_utc IS NOT NULL AND end_utc IS NOT NULL`,
    )
    .bind(ctx.athleteId, ctx.generation, addDays(ctx.asOf, -(MIX_DAYS - 1)), ctx.asOf)
    .all<{ category: string; start_utc: string; end_utc: string }>();
  const minutes = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<(typeof CATEGORIES)[number], number>;
  for (const r of results) {
    const key = (CATEGORIES as readonly string[]).includes(r.category) ? (r.category as (typeof CATEGORIES)[number]) : "mixed";
    minutes[key] += Math.max(0, (Date.parse(r.end_utc) - Date.parse(r.start_utc)) / 60_000);
  }
  const total = Object.values(minutes).reduce((a, b) => a + b, 0);
  const value = Object.fromEntries(CATEGORIES.map((c) => [c, total ? minutes[c] / total : 0]));
  const display = total
    ? CATEGORIES.filter((c) => value[c] > 0)
        .sort((a, b) => value[b] - value[a])
        .map((c) => `${c[0].toUpperCase()}${c.slice(1)} ${formatPercent(value[c])}`)
        .join(" · ")
    : "No sessions in the last 8 weeks";
  return {
    type: "training_mix",
    value,
    display,
    context: `${Math.round(total)} minutes over 8 weeks`,
    calc: calc(description, { query: `sessions with local_date in ${addDays(ctx.asOf, -(MIX_DAYS - 1))}…${ctx.asOf}` }),
  };
}

function storiesPlaceholder(): TileEnvelope {
  return {
    type: "stories_placeholder",
    value: { status: "coming_soon" },
    display: "Coming soon",
    context: "Your first story is being reported.",
    calc: calc("Stories are written from your full history once the story engine ships."),
  };
}

export async function computeTile(type: TileType, ctx: TileContext): Promise<TileEnvelope> {
  switch (type) {
    case "week_sessions":
      return weekSessions(ctx);
    case "streak":
      return streak(ctx);
    case "recent_sessions":
      return recentSessions(ctx);
    case "training_mix":
      return trainingMix(ctx);
    case "stories_placeholder":
      return storiesPlaceholder();
    default:
      return emptyTile(type, "This tile is computed in the next step of the dashboard build.");
  }
}

export { formatLoad };
