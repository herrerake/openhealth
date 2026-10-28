import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { findCandidates, matchByDuration, plannedBlocks, priorSeconds, raceBlocks, validStarts } from "../../src/core/timeline";
import { DATA, ensureGenerated, readExpected, readHyrox, readSessions } from "./fixture-helpers";

let expected: any;
let sessions: any[];
let records: any[];
beforeAll(() => {
  ensureGenerated();
  expected = readExpected();
  sessions = readSessions();
  records = JSON.parse(readFileSync(join(DATA, "apple-health/records.json"), "utf8"));
});

const clubHybrid = (date: string) => sessions.find((s) => s.wod?.occurs_on === date && s.wod.program.name === "Club Hybrid");

describe("planned blocks", () => {
  it("labels WodUp blocks the way the coach writes them", () => {
    expect(plannedBlocks(clubHybrid("2026-10-19").results).map((b) => b.label)).toEqual([
      "Warm Up",
      "A. Deadlift",
      "B. Push Press",
      "C. Circuit",
      "D. FC finisher",
    ]);
  });

  it("reads expected lengths from prescriptions", () => {
    const threshold = sessions.flatMap((s) => s.results).find((r: any) => /^6x5min/.test(r.prescribed_workout.description));
    expect(priorSeconds(threshold)).toBe((6 * 5 + 5 * 2) * 60);
    const amrap = sessions.flatMap((s) => s.results).find((r: any) => r.prescribed_workout.details?.duration === 40);
    expect(priorSeconds(amrap)).toBe(40 * 60);
  });
});

describe("matching blocks to heart rate", () => {
  it("lands most class block starts within two minutes of the truth", () => {
    const series = new Map(records.filter((r) => r.kind === "hr_series").map((r) => [r.payload.workoutKey, r.payload]));
    const workouts = new Map(records.filter((r) => r.kind === "workout").map((r) => [r.naturalKey, r]));
    const errors: number[] = [];
    for (const t of expected.timelines.filter((x: any) => x.kind === "class")) {
      const w = workouts.get(`workout:${t.appleWorkout}`);
      const s = series.get(`workout:${t.appleWorkout}`);
      const sess = clubHybrid(t.localDate);
      if (!w || !s || !sess) continue;
      const start = Date.parse(w.startUtc);
      const total = (Date.parse(w.endUtc) - start) / 1000;
      const candidates = findCandidates(s.points, s.stepS, total);
      const starts = matchByDuration(plannedBlocks(sess.results), candidates, total);
      expect(starts).toHaveLength(t.blocks.length - 1);
      starts.forEach((id, i) => errors.push(Math.abs(candidates[id].offsetS - (Date.parse(t.blocks[i + 1].start) - start) / 1000)));
    }
    errors.sort((a, b) => a - b);
    expect(errors.length).toBeGreaterThan(500);
    expect(errors[Math.floor(errors.length / 2)]).toBeLessThanOrEqual(60);
    expect(errors.filter((e) => e <= 120).length / errors.length).toBeGreaterThanOrEqual(0.8);
  });

  it("only accepts real candidates in increasing order", () => {
    const planned = plannedBlocks(clubHybrid("2026-10-19").results);
    const candidates = [10, 20, 30, 40, 50].map((m, id) => ({ id, offsetS: m * 60, strength: 0.5, kind: "dip" as const }));
    expect(validStarts([0, 1, 2, 3], planned, candidates)).toBe(true);
    expect(validStarts([0, 2, 1, 3], planned, candidates)).toBe(false);
    expect(validStarts([0, 1, 2, 99], planned, candidates)).toBe(false);
    expect(validStarts([0, 1, 2], planned, candidates)).toBe(false);
    expect(validStarts("0,1,2,3", planned, candidates)).toBe(false);
  });
});

describe("race timeline", () => {
  it("lays the official splits end to end, matching the planted truth", () => {
    const result = readHyrox().results.find((r: any) => r.event.date === "2026-09-19");
    const t = expected.timelines.find((x: any) => x.kind === "race" && x.localDate === "2026-09-19");
    const workout = records.find((r) => r.kind === "workout" && r.naturalKey === `workout:${t.appleWorkout}`);
    const wave = Date.parse(`${result.waveStart}-05:00`);
    const blocks = raceBlocks(result, (wave - Date.parse(workout.startUtc)) / 1000, []);
    expect(blocks).toHaveLength(16);
    const truth = t.blocks.filter((b: any) => b.label !== "Roxzone");
    blocks.forEach((b, i) => {
      expect(b.label).toBe(truth[i].label);
      expect(Math.abs(b.startS - (Date.parse(truth[i].start) - Date.parse(workout.startUtc)) / 1000)).toBeLessThanOrEqual(2);
    });
  });
});
