import { beforeAll, describe, expect, it } from "vitest";
import {
  allNotes,
  deadliftTopSets,
  ensureGenerated,
  firstAfterRun,
  longestRunAt,
  longestWeeksAtLeast,
  notesContaining,
  notesOn,
  raceResults,
  readExpected,
  recordsBetween,
} from "./fixture-helpers";

const STORY_IDS = [
  "block_build",
  "hyrox_sub_115",
  "march_setback",
  "summer_gap",
  "deadlift_plateau",
  "long_streak",
  "track_less_strain",
  "winter_fridays",
  "heavy_weeks",
  "wall_ball_words",
  "time_trial_standout",
];

let expected: any;
beforeAll(() => {
  ensureGenerated();
  expected = readExpected();
});

describe("planted storylines", () => {
  it("races HYROX in March and September of both years, ending under 1:15", () => {
    const r = raceResults();
    expect(r.map((x) => x.date.slice(0, 7))).toEqual(["2025-03", "2025-09", "2026-03", "2026-09"]);
    expect(r.map((x) => x.seconds)).toEqual([5294, 4900, 5095, 4472]);
    expect(r.at(-1)!.seconds).toBeLessThan(75 * 60);
  });

  it("steps back in March 2026 before the breakthrough", () => {
    const [, sept25, march26, sept26] = raceResults();
    expect(march26.seconds).toBeGreaterThan(sept25.seconds);
    expect(sept26.seconds).toBeLessThan(sept25.seconds);
  });

  it("has a 27-day gap with no records in any source", () => {
    expect(recordsBetween("2025-06-09", "2025-07-05")).toBe(0);
    expect(notesOn("2025-07-07")).toContain("First day back. Slow.");
  });

  it("deadlift 4x4 sits at 265 for three blocks then breaks to 275+", () => {
    const s = deadliftTopSets();
    expect(longestRunAt(s, 265)).toBeGreaterThanOrEqual(4);
    expect(firstAfterRun(s, 265)).toBeGreaterThanOrEqual(275);
    expect(s.at(-1)!.lbs).toBeGreaterThanOrEqual(285);
  });

  it("runs Club Hybrid in 13 eight-week blocks with deadlift 4x4 in weeks 6 and 8", () => {
    expect(expected.blocks).toHaveLength(13);
    expect(expected.blocks[0]).toEqual({ block: 1, from: "2024-10-28", to: "2024-12-22" });
    expect(expected.blocks.at(-1)).toEqual({ block: 13, from: "2026-08-31", to: "2026-10-25" });
    const weekOf = (date: string) => Math.floor((Date.parse(date) - Date.parse("2024-10-28")) / (7 * 86_400_000)) % 8 + 1;
    expect(new Set(deadliftTopSets().map((s) => weekOf(s.date)))).toEqual(new Set([6, 8]));
  });

  it("builds across the blocks: more 40-min AMRAP rounds and threshold reps", () => {
    const blocks = expected.storylines.find((x: any) => x.id === "block_build").facts.blocks;
    expect(blocks.at(-1).amrap40W8).toBeGreaterThan(blocks[0].amrap40W8 + 1);
    expect(blocks.at(-1).thresholdRepsW8).toBeGreaterThan(blocks[0].thresholdRepsW8 + 30);
  });

  it("has a 14-week run of 4+ sessions", () => {
    expect(longestWeeksAtLeast(expected.canonicalWorkouts, 4)).toBe(14);
  });

  it("runs the same 6 x 800m with a lower heart rate from spring to fall", () => {
    const s = expected.storylines.find((x: any) => x.id === "track_less_strain");
    expect(s.facts.sessions.length).toBeGreaterThanOrEqual(8);
    expect(s.facts.hrDropBpm).toBeGreaterThanOrEqual(4);
  });

  it("says 'wall balls' in 3+ notes across 2+ months", () => {
    const g = notesContaining("wall balls");
    expect(g.length).toBeGreaterThanOrEqual(3);
    expect(new Set(g.map((n) => n.date.slice(0, 7))).size).toBeGreaterThanOrEqual(2);
    expect(notesOn("2026-09-21")).toContain("Wall balls unbroken in Dallas. Finally.");
  });

  it("keeps the injection note verbatim", () => {
    expect(allNotes().some((n) => n.text.includes("IGNORE ALL PREVIOUS INSTRUCTIONS"))).toBe(true);
  });

  it("lists every storyline and decoy", () => {
    expect(expected.storylines.map((s: any) => s.id).sort()).toEqual([...STORY_IDS].sort());
    expect(expected.decoys.map((d: any) => d.id).sort()).toEqual(["short_trend", "single_great_day"]);
    for (const d of expected.decoys) expect(d.mustNotFire.length).toBeGreaterThan(0);
  });
});
