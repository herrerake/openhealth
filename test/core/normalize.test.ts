import { beforeAll, describe, expect, it } from "vitest";
import { normalize } from "../../src/core/normalize";
import type { StoredSourceRecord } from "../../src/core/types";
import { ensureGenerated, readHyrox, readSessions } from "./fixture-helpers";

let sessions: any[];
beforeAll(() => {
  ensureGenerated();
  sessions = readSessions();
});

let nextId = 1;
const resultRecord = (result: any, localDate: string): StoredSourceRecord => ({
  id: nextId++,
  source: "wodup",
  kind: "result",
  naturalKey: `result:${result.id}`,
  payload: result,
  startUtc: result.done_at,
  endUtc: null,
  localDate,
  tz: null,
});
const findResult = (date: string, pred: (r: any) => boolean) => {
  const s = sessions.find((x) => x.wod?.occurs_on === date && x.results.some(pred));
  return resultRecord(s.results.find(pred), date);
};

const findAny = (pred: (r: any) => boolean) => {
  const s = sessions.find((x) => x.wod && x.results.some(pred));
  return resultRecord(s.results.find(pred), s.wod.occurs_on);
};

describe("WodUp results", () => {
  it("tags the deadlift 4x4 with its load", () => {
    const rec = findResult("2026-10-19", (r) => r.movements[0]?.name === "Deadlift");
    expect(normalize(rec).results).toEqual([
      expect.objectContaining({ recordKey: rec.naturalKey, benchmark: "deadlift_4x4", metric: "load_lbs", value: 285, unit: "lbs", localDate: "2026-10-19" }),
    ]);
  });

  it("keeps other lifts untagged", () => {
    const rec = findResult("2026-10-19", (r) => r.movements[0]?.name === "Push Press");
    expect(normalize(rec).results[0]).toMatchObject({ benchmark: null, movement: "Push Press", metric: "load_lbs" });
  });

  it("tags the 5k time trial", () => {
    const rec = findResult("2026-10-01", (r) => r.prescribed_workout.name === "5k Time Trial");
    expect(normalize(rec).results[0]).toMatchObject({ benchmark: "run_5k_tt", metric: "time_s", value: rec.payload && (rec.payload as any).details.sets[0].duration });
  });

  it("tags the 40-minute AMRAP with rounds plus the finished share of the next round", () => {
    const rec = findAny((r) => r.type === "AmrapResult" && r.prescribed_workout.details.duration === 40);
    const d = (rec.payload as any).details;
    expect(normalize(rec).results[0]).toMatchObject({ benchmark: "amrap_40", movement: "Main Block", metric: "rounds", value: d.rounds + d.partial_index / 5 });
  });

  it("keeps a shorter AMRAP's rounds without a benchmark", () => {
    const rec = findAny((r) => r.type === "AmrapResult" && r.prescribed_workout.details.duration !== 40);
    expect(normalize(rec).results[0]).toMatchObject({ benchmark: null, metric: "rounds" });
  });

  it("scores threshold intervals by max reps", () => {
    const rec = findAny((r) => r.prescribed_workout.name === "Threshold Intervals");
    expect(normalize(rec).results[0]).toMatchObject({ movement: "Threshold Intervals", metric: "reps", value: (rec.payload as any).details.reps });
  });

  it("averages track reps per interval", () => {
    const rec = findAny((r) => r.type === "CardioIntervalsResult");
    const sets = (rec.payload as any).details.sets;
    const avg = Math.round((sets.reduce((a: number, x: any) => a + x.duration, 0) / sets.length) * 10) / 10;
    expect(normalize(rec).results[0]).toMatchObject({ benchmark: null, metric: "time_s", unit: "s/rep", value: avg });
  });

  it("yields nothing for a warm-up", () => {
    const rec = findResult("2026-10-19", (r) => r.type === "WarmUpResult");
    expect(normalize(rec)).toEqual({ results: [], measurements: [], notes: [] });
  });

  it("converts kg and pood loads to lbs", () => {
    const base = findResult("2026-10-19", (r) => r.movements[0]?.name === "Deadlift");
    const kg = structuredClone(base);
    (kg.payload as any).details.sets = (kg.payload as any).details.sets.map((s: any) => ({ ...s, load: 100, load_unit: "kg" }));
    expect(normalize(kg).results[0].value).toBe(220.5);
    const pood = structuredClone(base);
    (pood.payload as any).details.sets = (pood.payload as any).details.sets.map((s: any) => ({ ...s, load: 2, load_unit: "pood" }));
    expect(normalize(pood).results[0].value).toBe(72.2);
  });

  it("emits the athlete's note verbatim", () => {
    const rec = findResult("2026-09-21", (r) => r.notes === "Wall balls unbroken in Dallas. Finally.");
    expect(normalize(rec).notes).toEqual([{ recordKey: rec.naturalKey, localDate: "2026-09-21", text: "Wall balls unbroken in Dallas. Finally." }]);
  });
});

describe("HYROX results", () => {
  it("tags the official finish time", () => {
    const dallas = readHyrox().results.find((r: any) => r.event.date === "2026-09-19");
    const rec: StoredSourceRecord = { id: 800, source: "hyrox", kind: "race_result", naturalKey: `race:${dallas.id}`, payload: dallas, startUtc: null, endUtc: null, localDate: "2026-09-19", tz: null };
    expect(normalize(rec).results).toEqual([
      expect.objectContaining({ benchmark: "hyrox_total", movement: "HYROX 2026 Dallas", metric: "time_s", value: 4472, localDate: "2026-09-19" }),
    ]);
  });
});

describe("Apple Health records", () => {
  const workout: StoredSourceRecord = {
    id: 900,
    source: "apple_health",
    kind: "workout",
    naturalKey: "workout:Henry’s Apple Watch|HKWorkoutActivityTypeRunning|2026-10-18 07:30:00 -0700",
    payload: {
      workoutActivityType: "HKWorkoutActivityTypeRunning",
      sourceName: "Henry’s Apple Watch",
      startDate: "2026-10-18 07:30:00 -0700",
      endDate: "2026-10-18 07:54:52 -0700",
      indoor: false,
      metadata: {},
      statistics: {},
      totals: { duration_s: 1492, active_kcal: 251.3, distance_m: 5210 },
    },
    startUtc: "2026-10-18T14:30:00Z",
    endUtc: "2026-10-18T14:54:52Z",
    localDate: "2026-10-18",
    tz: "-0700",
  };

  it("yields duration, calories and distance for a run", () => {
    const m = normalize(workout).measurements.map((x) => [x.type, x.value]);
    expect(m).toEqual(expect.arrayContaining([["duration_s", 1492], ["active_kcal", 251.3], ["distance_m", 5210]]));
  });

  it("yields hr_avg and hr_max from an HR aggregate", () => {
    const agg: StoredSourceRecord = {
      ...workout,
      id: 901,
      kind: "hr_aggregate",
      naturalKey: `hr:${workout.naturalKey}`,
      payload: { workoutKey: workout.naturalKey, avg: 149, max: 176, samples: 99, gapsOver5Min: 0, fileSha256: "abc" },
    };
    expect(normalize(agg).measurements.map((x) => [x.type, x.value])).toEqual([["hr_avg", 149], ["hr_max", 176]]);
  });

  it("yields resting HR, HRV and sleep minutes from daily metrics", () => {
    const daily = (type: string, value: number | string, start: string, end: string): StoredSourceRecord => ({
      ...workout,
      kind: "daily_metric",
      naturalKey: `daily:${type}|w|${start}`,
      payload: { type, value, unit: "", sourceName: "w", startDate: start, endDate: end },
    });
    expect(normalize(daily("HKQuantityTypeIdentifierRestingHeartRate", 55, "2026-10-18 00:00:00 -0700", "2026-10-18 23:59:00 -0700")).measurements[0]).toMatchObject({ type: "rhr", value: 55 });
    expect(normalize(daily("HKQuantityTypeIdentifierHeartRateVariabilitySDNN", 54.2, "2026-10-18 05:10:00 -0700", "2026-10-18 05:11:00 -0700")).measurements[0]).toMatchObject({ type: "hrv_sdnn", value: 54.2 });
    expect(normalize(daily("HKCategoryTypeIdentifierSleepAnalysis", "HKCategoryValueSleepAnalysisAsleepUnspecified", "2026-10-17 22:40:00 -0700", "2026-10-18 05:55:00 -0700")).measurements[0]).toMatchObject({ type: "sleep_min", value: 435, localDate: "2026-10-18" });
  });

  it("ignores in-bed and awake sleep records", () => {
    const rec: StoredSourceRecord = { ...workout, kind: "daily_metric", payload: { type: "HKCategoryTypeIdentifierSleepAnalysis", value: "HKCategoryValueSleepAnalysisInBed", startDate: "2026-10-17 22:00:00 -0700", endDate: "2026-10-18 06:00:00 -0700" } };
    expect(normalize(rec).measurements).toEqual([]);
  });
});

describe("malformed records", () => {
  it("yield nothing instead of throwing", () => {
    const base = { id: 1, naturalKey: "x", startUtc: null, endUtc: null, localDate: null, tz: null };
    expect(normalize({ ...base, source: "apple_health", kind: "daily_metric", payload: { type: "HKQuantityTypeIdentifierRestingHeartRate", value: 1 } })).toEqual({ results: [], measurements: [], notes: [] });
    expect(normalize({ ...base, source: "apple_health", kind: "workout", payload: null })).toEqual({ results: [], measurements: [], notes: [] });
    expect(normalize({ ...base, source: "wodup", kind: "result", payload: null })).toEqual({ results: [], measurements: [], notes: [] });
  });
});

describe("Mindbody visits", () => {
  it("yield nothing", () => {
    const visit: StoredSourceRecord = { id: 1, source: "mindbody", kind: "visit", naturalKey: "visit:1", payload: {}, startUtc: null, endUtc: null, localDate: "2026-10-18", tz: null };
    expect(normalize(visit)).toEqual({ results: [], measurements: [], notes: [] });
  });
});
