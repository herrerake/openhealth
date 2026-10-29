import type { AppleWorkoutPayload, HrAggregatePayload } from "../../core/normalize";
import { cadenceSpm, metersPerBeat, paceSPerKm, runningForm, verticalRatioPct } from "../../core/running";
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
import type { Env } from "../env";
import { aiMatch } from "./aiMatch";

/**
 * Distance, pace and running form for a watch run. On race day the watch's indoor distance is
 * unreliable (D-037), so pace and meters per heartbeat, which depend on it, are left out. So is
 * cadence: averaged across the stations as well as the runs, it doesn't describe the running (D-051).
 */
function running(p: AppleWorkoutPayload, totalS: number, avgHr: number | null, race: boolean) {
  const form = runningForm(p.statistics);
  if (!form) return null;
  const distanceM = race ? null : (p.totals?.distance_m ?? null);
  const durationS = p.totals?.duration_s ?? totalS;
  return {
    ...form,
    distanceM,
    paceSPerKm: distanceM != null ? paceSPerKm(distanceM, durationS) : null,
    metersPerBeat: distanceM != null && avgHr != null ? metersPerBeat(distanceM, durationS, avgHr) : null,
    verticalRatioPct: form.verticalOscillationCm != null && form.strideM != null ? verticalRatioPct(form.verticalOscillationCm, form.strideM) : null,
    cadenceSpm: !race && form.speedMps != null && form.strideM != null ? cadenceSpm(form.speedMps, form.strideM) : null,
    wholeRace: race,
  };
}

const seconds = (fromUtc: string, toUtc: string) => (Date.parse(toUtc) - Date.parse(fromUtc)) / 1000;

export type SessionTimeline = NonNullable<Awaited<ReturnType<typeof sessionTimeline>>>;

/**
 * The session timeline (D-038): heart rate across the workout with its blocks laid over it.
 * Block edges come from the official race splits, the watch's segments, or (for classes) a match
 * of the WodUp blocks to boundaries found in the heart rate, labeled as estimates.
 * With `callModel: false` a class uses a cached AI match if there is one and never makes a new call
 * (dashboard tiles read many timelines at once). Null when the session doesn't exist.
 */
export async function sessionTimeline(
  env: Pick<Env, "DB" | "RAW" | "ANTHROPIC_API_KEY" | "SITE_TZ">,
  athleteId: string,
  generation: string,
  sessionKey: string,
  { callModel = true }: { callModel?: boolean } = {},
) {
  const session = await env.DB.prepare(
    `SELECT id, session_key, local_date, kind, start_utc, end_utc FROM sessions WHERE athlete_id = ? AND generation = ? AND session_key = ?`,
  )
    .bind(athleteId, generation, sessionKey)
    .first<{ id: number; session_key: string; local_date: string; kind: string; start_utc: string; end_utc: string }>();
  if (!session) return null;
  const athlete = await env.DB.prepare("SELECT tz FROM athletes WHERE id = ?").bind(athleteId).first<{ tz: string }>();

  const { results: sources } = await env.DB.prepare(
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
  const base = { sessionKey: session.session_key, localDate: session.local_date, kind: session.kind, title, tz: athlete?.tz ?? env.SITE_TZ };

  if (!workout) {
    // No watch workout (the watch died): the plan is known, the timing isn't.
    const planned = plannedBlocks(ordered);
    return {
      ...base,
      startUtc: session.start_utc,
      method: "none" satisfies TimelineMethod,
      hr: null,
      blocks: planned.map((p) => ({ label: p.label, prescription: p.prescription, startS: null, endS: null, source: "estimated", avgHr: null, maxHr: null })),
      summary: null,
      spoken: "No heart rate was recorded for this session.",
    };
  }

  const startUtc = workout.start_utc!;
  const totalS = seconds(startUtc, workout.end_utc!);
  const [series, aggregate] = await Promise.all(
    ["hrs", "hr"].map((prefix) =>
      env.DB.prepare("SELECT payload FROM source_records WHERE athlete_id = ? AND natural_key = ?")
        .bind(athleteId, `${prefix}:${workout.natural_key}`)
        .first<{ payload: string }>(),
    ),
  );
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
    const ai = await aiMatch(env, `${athleteId}/${encodeURIComponent(workout.natural_key)}`, planned, candidates, totalS, { call: callModel });
    const starts = ai ?? matchByDuration(planned, candidates, totalS);
    if (starts.length === planned.length - 1) {
      method = ai ? "ai_match" : "duration_match";
      blocks = blocksFromStarts(planned, starts.map((id) => byId.get(id)!), totalS, points, "estimated");
    }
  }
  if (!blocks.length) {
    const label = ordered.length === 1 ? plannedBlocks(ordered)[0].label : title;
    blocks = [{ label, prescription: null, startS: 0, endS: Math.round(totalS), source: "watch", ...hrStats(points, 0, totalS) }];
    // The badge must agree with the chart: heart rate shown in one block isn't "no heart rate".
    if (points.length) method = "whole_workout";
  }

  const whole = hrStats(points, 0, totalS);
  // The watch's own average, as stored for the dashboard: none when it recorded no samples.
  const agg = aggregate ? (JSON.parse(aggregate.payload) as HrAggregatePayload) : null;
  const watchAvgHr = agg && agg.samples > 0 ? agg.avg : null;
  return {
    ...base,
    startUtc,
    method,
    hr,
    blocks,
    summary: { minutes: Math.round(totalS / 60), ...whole },
    running: running(json(workout) as AppleWorkoutPayload, totalS, watchAvgHr, !!race),
    spoken: spokenSummary(blocks, method),
  };
}
