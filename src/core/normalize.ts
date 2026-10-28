import { runningForm } from "./running";
import { parseAppleDate } from "./time";
import type { StoredSourceRecord } from "./types";

// Turns stored source payloads into normalized rows. Units: lbs, meters, seconds, bpm, ms, minutes.

export type Benchmark = "hyrox_total" | "amrap_40" | "deadlift_4x4" | "run_5k_tt";

export interface ResultRow {
  recordKey: string;
  benchmark: Benchmark | null;
  movement: string;
  scaling: string;
  metric: "time_s" | "load_lbs" | "distance_m" | "rounds" | "reps";
  value: number;
  unit: string;
  localDate: string;
}

export interface MeasurementRow {
  recordKey: string;
  type:
    | "hr_avg"
    | "hr_max"
    | "active_kcal"
    | "distance_m"
    | "duration_s"
    | "rhr"
    | "hrv_sdnn"
    | "sleep_min"
    | "run_power_w"
    | "run_speed_mps"
    | "run_stride_m"
    | "run_gct_ms"
    | "run_vo_cm";
  value: number;
  unit: string;
  startUtc: string | null;
  endUtc: string | null;
  localDate: string;
}

export interface NoteRow {
  recordKey: string;
  localDate: string;
  text: string;
}

export interface Normalized {
  results: ResultRow[];
  measurements: MeasurementRow[];
  notes: NoteRow[];
}

/** Payload of an Apple `workout` record, as produced by the export parser. */
export interface AppleWorkoutPayload {
  workoutActivityType: string;
  sourceName: string;
  startDate: string;
  endDate: string;
  indoor: boolean | null;
  metadata: Record<string, string>;
  statistics: Record<string, { sum?: number; average?: number; minimum?: number; maximum?: number; unit?: string }>;
  totals: { duration_s?: number; active_kcal?: number; distance_m?: number };
  /** Segment and lap markers the watch recorded during the workout. */
  segments?: { type: "segment" | "lap"; startUtc: string; seconds: number }[];
}

/** Payload of an Apple `daily_metric` record (resting HR, HRV, sleep). */
export interface AppleDailyPayload {
  type: string;
  value: number | string;
  unit?: string;
  sourceName?: string;
  startDate: string;
  endDate: string;
}

/** Payload of an `hr_aggregate` record, computed on device from raw heart-rate samples. */
export interface HrAggregatePayload {
  workoutKey: string;
  avg: number;
  max: number;
  samples: number;
  gapsOver5Min: number;
  fileSha256: string;
}

/** Payload of an `hr_series` record: mean heart rate per `stepS` seconds from the workout start. */
export interface HrSeriesPayload {
  workoutKey: string;
  stepS: number;
  /** [seconds from workout start, bpm]; buckets without samples are left out, not zeroed. */
  points: [number, number][];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const LOAD_TO_LBS: Record<string, number> = { lbs: 1, kg: 2.20462, pood: 36.1128 };
const DISTANCE_TO_M: Record<string, number> = { meters: 1, km: 1000, miles: 1609.344, yards: 0.9144, feet: 0.3048 };
const DURATION_TO_S: Record<string, number> = { seconds: 1, minutes: 60 };

const toLbs = (load: number, unit = "lbs") => round1(load * (LOAD_TO_LBS[unit] ?? 1));
const toMeters = (d: number, unit = "meters") => round1(d * (DISTANCE_TO_M[unit] ?? 1));
const toSeconds = (d: number, unit = "seconds") => round1(d * (DURATION_TO_S[unit] ?? 1));

const ASLEEP = new Set([
  "HKCategoryValueSleepAnalysisAsleep",
  "HKCategoryValueSleepAnalysisAsleepUnspecified",
  "HKCategoryValueSleepAnalysisAsleepCore",
  "HKCategoryValueSleepAnalysisAsleepDeep",
  "HKCategoryValueSleepAnalysisAsleepREM",
]);

const empty = (): Normalized => ({ results: [], measurements: [], notes: [] });

function wodupResult(rec: StoredSourceRecord): Normalized {
  const r = rec.payload as any;
  const out = empty();
  const localDate = rec.localDate ?? "";
  const movement: string = r.movements?.[0]?.name ?? r.prescribed_workout?.name ?? r.type;
  const base = { recordKey: rec.naturalKey, movement, scaling: r.scaling ?? "rx", localDate };
  const sets: any[] = r.details?.sets ?? [];

  switch (r.type) {
    case "FranStyleResult":
    case "ForTimeResult": {
      if (typeof r.details?.total === "number") out.results.push({ ...base, benchmark: null, metric: "time_s", value: r.details.total, unit: "s" });
      break;
    }
    case "StrengthResult": {
      const loads = sets.filter((s) => typeof s.load === "number");
      if (!loads.length) break;
      const fours = sets.length === 4 && sets.every((s) => Number(s.reps) === 4);
      const benchmark: Benchmark | null = movement === "Deadlift" && fours ? "deadlift_4x4" : null;
      const value = Math.max(...loads.map((s) => toLbs(s.load, s.load_unit)));
      out.results.push({ ...base, benchmark, metric: "load_lbs", value, unit: "lbs" });
      break;
    }
    case "CardioResult": {
      const s = sets[0];
      if (!s) break;
      const distance = typeof s.distance === "number" ? toMeters(s.distance, s.distance_unit) : null;
      const duration = typeof s.duration === "number" ? toSeconds(s.duration, s.duration_unit) : null;
      if (duration != null) {
        const isTimeTrial = movement === "Run" && distance === 5000 && /time trial/i.test(r.prescribed_workout?.name ?? "");
        out.results.push({ ...base, benchmark: isTimeTrial ? "run_5k_tt" : null, metric: "time_s", value: duration, unit: "s" });
      } else if (distance != null) {
        out.results.push({ ...base, benchmark: null, metric: "distance_m", value: distance, unit: "m" });
      }
      break;
    }
    case "CardioIntervalsResult": {
      const durations = sets.filter((s) => typeof s.duration === "number").map((s) => toSeconds(s.duration, s.duration_unit));
      if (durations.length) {
        const label = r.prescribed_workout?.name ?? movement;
        out.results.push({ ...base, movement: label, benchmark: null, metric: "time_s", value: round1(durations.reduce((a, b) => a + b, 0) / durations.length), unit: "s/rep" });
      }
      break;
    }
    case "AmrapResult": {
      if (typeof r.details?.rounds === "number") {
        // Rounds plus the share of the next round's movements finished: 5 rounds + 2 of 5 movements = 5.4.
        const perRound = r.prescribed_workout?.details?.movements?.length || r.movements?.length || 1;
        const value = round1(r.details.rounds + (r.details.partial_index ?? 0) / perRound);
        const isBenchmark = r.prescribed_workout?.details?.duration === 40 && perRound === 5;
        out.results.push({ ...base, movement: r.prescribed_workout?.name ?? movement, benchmark: isBenchmark ? "amrap_40" : null, metric: "rounds", value, unit: "rounds" });
      }
      break;
    }
    case "GenericResult": {
      if (typeof r.details?.reps === "number") {
        out.results.push({ ...base, movement: r.prescribed_workout?.name ?? movement, benchmark: null, metric: "reps", value: r.details.reps, unit: "reps" });
      }
      break;
    }
  }
  if (typeof r.notes === "string" && r.notes.trim()) out.notes.push({ recordKey: rec.naturalKey, localDate, text: r.notes });
  return out;
}

/** A HYROX result: the official finish time is the benchmark (splits stay in the payload for the timeline). */
function hyroxResult(rec: StoredSourceRecord): Normalized {
  const r = rec.payload as any;
  const out = empty();
  const [h, m, s] = String(r.overall?.time ?? "").split(":").map(Number);
  const total = h * 3600 + m * 60 + s;
  if (Number.isFinite(total) && total > 0) {
    out.results.push({ recordKey: rec.naturalKey, benchmark: "hyrox_total", movement: `HYROX ${r.event?.name ?? ""}`.trim(), scaling: r.division ?? "open", metric: "time_s", value: total, unit: "s", localDate: rec.localDate ?? "" });
  }
  return out;
}

function appleWorkout(rec: StoredSourceRecord): Normalized {
  const p = rec.payload as AppleWorkoutPayload;
  const out = empty();
  const m = (type: MeasurementRow["type"], value: number | undefined, unit: string) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      out.measurements.push({ recordKey: rec.naturalKey, type, value, unit, startUtc: rec.startUtc, endUtc: rec.endUtc, localDate: rec.localDate ?? "" });
    }
  };
  m("duration_s", p.totals?.duration_s, "s");
  m("active_kcal", p.totals?.active_kcal, "kcal");
  m("distance_m", p.totals?.distance_m, "m");
  const form = runningForm(p.statistics);
  if (form) {
    m("run_power_w", form.powerW ?? undefined, "W");
    m("run_speed_mps", form.speedMps ?? undefined, "m/s");
    m("run_stride_m", form.strideM ?? undefined, "m");
    m("run_gct_ms", form.groundContactMs ?? undefined, "ms");
    m("run_vo_cm", form.verticalOscillationCm ?? undefined, "cm");
  }
  return out;
}

function hrAggregate(rec: StoredSourceRecord): Normalized {
  const p = rec.payload as HrAggregatePayload;
  const out = empty();
  const row = { recordKey: rec.naturalKey, unit: "bpm", startUtc: rec.startUtc, endUtc: rec.endUtc, localDate: rec.localDate ?? "" };
  if (p.samples > 0) out.measurements.push({ ...row, type: "hr_avg", value: p.avg }, { ...row, type: "hr_max", value: p.max });
  return out;
}

function appleDaily(rec: StoredSourceRecord): Normalized {
  const p = rec.payload as AppleDailyPayload;
  const out = empty();
  const start = parseAppleDate(p.startDate);
  const end = parseAppleDate(p.endDate);
  const row = { recordKey: rec.naturalKey, startUtc: start.utc, endUtc: end.utc };
  if (p.type === "HKQuantityTypeIdentifierRestingHeartRate") {
    out.measurements.push({ ...row, type: "rhr", value: Number(p.value), unit: "bpm", localDate: start.localDate });
  } else if (p.type === "HKQuantityTypeIdentifierHeartRateVariabilitySDNN") {
    out.measurements.push({ ...row, type: "hrv_sdnn", value: Number(p.value), unit: "ms", localDate: start.localDate });
  } else if (p.type === "HKCategoryTypeIdentifierSleepAnalysis" && ASLEEP.has(String(p.value))) {
    const minutes = Math.round((Date.parse(end.utc) - Date.parse(start.utc)) / 60_000);
    out.measurements.push({ ...row, type: "sleep_min", value: minutes, unit: "min", localDate: end.localDate });
  }
  return out;
}

/** A record whose payload can't be read yields nothing rather than failing the athlete's whole rebuild. */
export function normalize(rec: StoredSourceRecord): Normalized {
  if (!rec.payload || typeof rec.payload !== "object") return empty();
  try {
    if (rec.source === "wodup" && rec.kind === "result") return wodupResult(rec);
    if (rec.source === "apple_health" && rec.kind === "workout") return appleWorkout(rec);
    if (rec.source === "hyrox" && rec.kind === "race_result") return hyroxResult(rec);
    if (rec.kind === "hr_aggregate") return hrAggregate(rec);
    if (rec.kind === "daily_metric") return appleDaily(rec);
  } catch {
    return empty();
  }
  return empty();
}
