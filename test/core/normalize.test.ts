import { beforeAll, describe, expect, it } from "vitest";
import { normalize } from "../../src/core/normalize";
import type { StoredSourceRecord } from "../../src/core/types";
import { ensureGenerated, readSessions } from "./fixture-helpers";

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

describe("WodUp results", () => {
  it("tags Fran", () => {
    const rec = findResult("2026-10-20", (r) => r.type === "FranStyleResult");
    expect(normalize(rec).results).toEqual([
      expect.objectContaining({ recordKey: rec.naturalKey, benchmark: "fran", metric: "time_s", value: 261, unit: "s", localDate: "2026-10-20" }),
    ]);
  });

  it("tags the 2k row", () => {
    const rec = findResult("2026-10-22", (r) => r.type === "CardioResult");
    expect(normalize(rec).results[0]).toMatchObject({ benchmark: "row_2k", metric: "time_s", value: 455 });
  });

  it("tags back squat 5x5 with the top load", () => {
    const rec = findResult("2026-10-19", (r) => r.movements[0]?.name === "Back Squat");
    expect(normalize(rec).results[0]).toMatchObject({ benchmark: "back_squat_5x5", metric: "load_lbs", value: 245 });
  });

  it("tags a deadlift single as the 1RM", () => {
    const rec = findResult("2026-10-22", (r) => r.movements[0]?.name === "Deadlift");
    expect(normalize(rec).results[0]).toMatchObject({ benchmark: "deadlift_1rm", metric: "load_lbs", value: 385 });
  });

  it("does not tag a deadlift 3x5 as a 1RM", () => {
    const rec = findResult("2026-10-15", (r) => r.movements[0]?.name === "Deadlift");
    expect(normalize(rec).results[0]).toMatchObject({ benchmark: null, movement: "Deadlift", metric: "load_lbs", value: 345 });
  });

  it("converts kg and pood loads to lbs", () => {
    const base = findResult("2026-10-19", (r) => r.movements[0]?.name === "Back Squat");
    const kg = structuredClone(base);
    (kg.payload as any).details.sets = (kg.payload as any).details.sets.map((s: any) => ({ ...s, load: 100, load_unit: "kg" }));
    expect(normalize(kg).results[0].value).toBe(220.5);
    const pood = structuredClone(base);
    (pood.payload as any).details.sets = (pood.payload as any).details.sets.map((s: any) => ({ ...s, load: 2, load_unit: "pood" }));
    expect(normalize(pood).results[0].value).toBe(72.2);
  });

  it("emits the athlete's note verbatim", () => {
    const rec = findResult("2026-10-20", (r) => r.type === "FranStyleResult");
    expect(normalize(rec).notes).toEqual([{ recordKey: rec.naturalKey, localDate: "2026-10-20", text: "Unbroken thrusters. Finally." }]);
  });

  it("skips an AMRAP with no benchmark but keeps its rounds", () => {
    const rec = findResult("2026-10-19", (r) => r.type === "AmrapResult");
    expect(normalize(rec).results[0]).toMatchObject({ benchmark: null, metric: "rounds" });
  });
});

describe("Apple Health records", () => {
  const workout: StoredSourceRecord = {
    id: 900,
    source: "apple_health",
    kind: "workout",
    naturalKey: "workout:Alex’s Apple Watch|HKWorkoutActivityTypeRunning|2026-10-18 07:30:00 -0700",
    payload: {
      workoutActivityType: "HKWorkoutActivityTypeRunning",
      sourceName: "Alex’s Apple Watch",
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

describe("Mindbody visits", () => {
  it("yield nothing", () => {
    const visit: StoredSourceRecord = { id: 1, source: "mindbody", kind: "visit", naturalKey: "visit:1", payload: {}, startUtc: null, endUtc: null, localDate: "2026-10-18", tz: null };
    expect(normalize(visit)).toEqual({ results: [], measurements: [], notes: [] });
  });
});
