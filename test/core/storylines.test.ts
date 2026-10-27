import { beforeAll, describe, expect, it } from "vitest";
import {
  allNotes,
  ensureGenerated,
  firstAfterRun,
  franResults,
  longestRunAt,
  longestWeeksAtLeast,
  notesContaining,
  notesOn,
  readExpected,
  recordsBetween,
  squatTopSetsByWeek,
} from "./fixture-helpers";

const STORY_IDS = [
  "fran_rematch",
  "summer_gap",
  "squat_plateau",
  "long_streak",
  "row_less_strain",
  "winter_fridays",
  "heavy_weeks",
  "grip_words",
  "row_standout",
];

let expected: any;
beforeAll(() => {
  ensureGenerated();
  expected = readExpected();
});

describe("planted storylines", () => {
  it("plants nine Frans stuck near 5:05 then 4:21", () => {
    const f = franResults();
    expect(f).toHaveLength(9);
    expect(f.at(-1)).toEqual({ date: "2026-10-20", seconds: 261 });
    expect(f.slice(0, 8).every((r) => r.seconds >= 295 && r.seconds <= 315)).toBe(true);
  });

  it("has a 27-day gap with no records in any source", () => {
    expect(recordsBetween("2025-06-09", "2025-07-05")).toBe(0);
    expect(notesOn("2025-07-07")).toContain("First day back. Slow.");
  });

  it("squat sits at 225 for 8+ weeks then breaks to 235+", () => {
    const s = squatTopSetsByWeek();
    expect(longestRunAt(s, 225)).toBeGreaterThanOrEqual(8);
    expect(firstAfterRun(s, 225)).toBeGreaterThanOrEqual(235);
    expect(s.at(-1)!.lbs).toBeGreaterThanOrEqual(240);
  });

  it("has a 14-week run of 4+ sessions", () => {
    expect(longestWeeksAtLeast(expected.canonicalWorkouts, 4)).toBe(14);
  });

  it("says 'grip' in 3+ notes across 2+ months", () => {
    const g = notesContaining("grip");
    expect(g.length).toBeGreaterThanOrEqual(3);
    expect(new Set(g.map((n) => n.date.slice(0, 7))).size).toBeGreaterThanOrEqual(2);
  });

  it("keeps the injection note verbatim", () => {
    expect(allNotes().some((n) => n.text.includes("IGNORE ALL PREVIOUS INSTRUCTIONS"))).toBe(true);
  });

  it("lists every storyline and decoy", () => {
    expect(expected.storylines.map((s: any) => s.id).sort()).toEqual([...STORY_IDS].sort());
    expect(expected.decoys.map((d: any) => d.id).sort()).toEqual(["short_trend", "single_great_day"]);
    for (const d of expected.decoys) expect(d.mustNotFire.length).toBeGreaterThan(0);
  });

  it("ends with the Unbroken note on Fran day", () => {
    expect(notesOn("2026-10-20")).toContain("Unbroken thrusters. Finally.");
  });
});
