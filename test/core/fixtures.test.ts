import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ROOT,
  appleWorkoutStarts,
  appleXmlPath,
  ensureGenerated,
  hashGeneratedTwice,
  maxLocalDate,
  minLocalDate,
  readExpected,
} from "./fixture-helpers";

let expected: any;
beforeAll(() => {
  ensureGenerated();
  expected = readExpected();
});

describe("two-year fixtures", () => {
  it("covers the two-year window", () => {
    expect(expected.window).toEqual({ from: "2024-10-28", to: "2026-10-25" });
    expect(minLocalDate(expected.canonicalWorkouts)).toBe("2024-10-28");
    expect(maxLocalDate(expected.canonicalWorkouts)).toBe("2026-10-25");
  });

  it("uses CST in winter and CDT in summer (Austin)", () => {
    const starts = appleWorkoutStarts();
    expect(starts.some((s) => s.startsWith("2025-01-") && s.endsWith("-0600"))).toBe(true);
    expect(starts.some((s) => s.startsWith("2025-07-") && s.endsWith("-0500"))).toBe(true);
  });

  it("records the true block times of every watch workout", () => {
    const kinds = new Set(expected.timelines.map((t: any) => t.kind));
    expect([...kinds].sort()).toEqual(["class", "open_gym", "race", "run", "track"]);
    const race = expected.timelines.find((t: any) => t.kind === "race" && t.localDate === "2026-09-19");
    expect(race.blocks.filter((b: any) => /^Running \d$/.test(b.label))).toHaveLength(8);
    expect(race.blocks.map((b: any) => b.label)).toContain("Wall Balls");
    const cls = expected.timelines.find((t: any) => t.kind === "class" && t.localDate === "2026-10-19");
    expect(cls.blocks.map((b: any) => b.label)).toEqual(["Warm Up", "A. Deadlift", "B. Push Press", "C. Circuit", "D. FC finisher"]);
  });

  it("anchors each race on its official result", () => {
    const races = expected.canonicalWorkouts.filter((c: any) => c.kind === "race");
    expect(races.map((c: any) => c.localDate)).toEqual(["2025-03-22", "2025-09-20", "2026-03-21", "2026-09-19"]);
    expect(races.every((c: any) => c.sources.hyroxResultId && c.sources.appleWorkouts.length === 1)).toBe(true);
  });

  it("keeps the 12 edge cases in the final four weeks", () => {
    const last4 = expected.canonicalWorkouts.filter((c: any) => c.localDate >= "2026-09-28");
    expect(last4.find((c: any) => c.localDate === "2026-10-14").status).toBe("review_required");
    expect(
      expected.duplicates.some((d: any) => d.duplicate.startsWith("Strava|") && d.duplicate.includes("2026-10-04")),
    ).toBe(true);
    expect(expected.unmatchedVisits.map((u: any) => u.reason)).toEqual(
      expect.arrayContaining(["late_cancelled", "no_show_overlaps_solo_run"]),
    );
    expect(expected.conflicts.some((c: any) => c.localDate === "2026-10-18")).toBe(true);
    const flags = last4.flatMap((c: any) => c.flags);
    for (const f of [
      "logged_hours_later",
      "missing_apple_workout",
      "apple_distance_missing",
      "missing_heart_rate_segment",
      "untrusted_note_text",
      "ambiguous_split_apple_workout",
      "no_booking",
      "utc_date_differs_from_local",
      "conflicting_distance_and_duration",
    ]) {
      expect(flags).toContain(f);
    }
  });

  it("stays under 40 MB for export.xml", () => {
    expect(statSync(appleXmlPath).size).toBeLessThan(40 * 1024 * 1024);
  });

  it("is deterministic", () => {
    expect(hashGeneratedTwice()).toEqual({ same: true });
  });

  it("passes validate.mjs", () => {
    expect(execFileSync("node", [join(ROOT, "fixtures/validate.mjs")]).toString()).toContain(
      "match the OpenAPI spec",
    );
  });
});
