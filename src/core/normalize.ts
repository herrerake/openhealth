import { parseAppleDate } from "./time";
import type { StoredSourceRecord } from "./types";

// Turns stored source payloads into normalized rows. Units: lbs, meters, seconds, bpm, ms, minutes.

export type Benchmark = "fran" | "row_2k" | "back_squat_5x5" | "deadlift_1rm";

export interface ResultRow {
  recordKey: string;
  benchmark: Benchmark | null;
  movement: string;
  scaling: string;
  metric: "time_s" | "load_lbs" | "distance_m" | "rounds";
  value: number;
  unit: string;
  localDate: string;
}

export interface MeasurementRow {
  recordKey: string;
  type: "hr_avg" | "hr_max" | "active_kcal" | "distance_m" | "duration_s" | "rhr" | "hrv_sdnn" | "sleep_min";
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
      if (typeof r.details?.total === "number") {
        const isFran = r.type === "FranStyleResult" && r.prescribed_workout?.name === "Fran" && r.scaling === "rx";
        out.results.push({ ...base, benchmark: isFran ? "fran" : null, metric: "time_s", value: r.details.total, unit: "s" });
      }
      break;
    }
    case "StrengthResult": {
      const loads = sets.filter((s) => typeof s.load === "number");
      if (!loads.length) break;
      const singles = loads.filter((s) => Number(s.reps) === 1);
      const fives = sets.length >= 5 && sets.every((s) => Number(s.reps) === 5);
      let benchmark: Benchmark | null = null;
      let pool = loads;
      if (movement === "Back Squat" && fives) benchmark = "back_squat_5x5";
      if (movement === "Deadlift" && singles.length) {
        benchmark = "deadlift_1rm";
        pool = singles;
      }
      const value = Math.max(...pool.map((s) => toLbs(s.load, s.load_unit)));
      out.results.push({ ...base, benchmark, metric: "load_lbs", value, unit: "lbs" });
      break;
    }
    case "CardioResult": {
      const s = sets[0];
      if (!s) break;
      const distance = typeof s.distance === "number" ? toMeters(s.distance, s.distance_unit) : null;
      const duration = typeof s.duration === "number" ? toSeconds(s.duration, s.duration_unit) : null;
      if (duration != null) {
        const isRow2k = movement === "Row" && distance === 2000;
        out.results.push({ ...base, benchmark: isRow2k ? "row_2k" : null, metric: "time_s", value: duration, unit: "s" });
      } else if (distance != null) {
        out.results.push({ ...base, benchmark: null, metric: "distance_m", value: distance, unit: "m" });
      }
      break;
    }
    case "AmrapResult": {
      if (typeof r.details?.rounds === "number") {
        out.results.push({ ...base, benchmark: null, metric: "rounds", value: r.details.rounds, unit: "rounds" });
      }
      break;
    }
  }
  if (typeof r.notes === "string" && r.notes.trim()) out.notes.push({ recordKey: rec.naturalKey, localDate, text: r.notes });
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

export function normalize(rec: StoredSourceRecord): Normalized {
  if (rec.source === "wodup" && rec.kind === "result") return wodupResult(rec);
  if (rec.source === "apple_health" && rec.kind === "workout") return appleWorkout(rec);
  if (rec.kind === "hr_aggregate") return hrAggregate(rec);
  if (rec.kind === "daily_metric") return appleDaily(rec);
  return empty();
}
