import { describe, expect, it } from "vitest";
import { reconcile } from "../../src/core/reconcile";
import type { StoredSourceRecord } from "../../src/core/types";

const TZ = "America/Los_Angeles";
let nextId = 1;
const base = (r: Omit<StoredSourceRecord, "id" | "tz">): StoredSourceRecord => ({ ...r, id: nextId++, tz: null });

const visit = (key: string, startUtc: string, endUtc: string, localDate: string) =>
  base({ source: "mindbody", kind: "visit", naturalKey: `visit:${key}`, payload: { SignedIn: true, LateCancelled: false }, startUtc, endUtc, localDate });
const workout = (key: string, startUtc: string, endUtc: string, localDate: string, type = "HKWorkoutActivityTypeFunctionalStrengthTraining") =>
  base({
    source: "apple_health",
    kind: "workout",
    naturalKey: `workout:Alex’s Apple Watch|${type}|${key}`,
    payload: { workoutActivityType: type, sourceName: "Alex’s Apple Watch", totals: {} },
    startUtc,
    endUtc,
    localDate,
  });
const wodup = (id: string, occursOn: string | null, doneUtc: string, localDate: string) => [
  base({ source: "wodup", kind: "training_session", naturalKey: `session:${id}`, payload: { id, wod: occursOn ? { occurs_on: occursOn } : null, resultIds: [`r_${id}`] }, startUtc: doneUtc, endUtc: doneUtc, localDate }),
  base({ source: "wodup", kind: "result", naturalKey: `result:r_${id}`, payload: { id: `r_${id}`, sessionId: id, type: "StrengthResult", movements: [{ name: "Back Squat" }] }, startUtc: doneUtc, endUtc: null, localDate }),
];

const keysOf = (records: StoredSourceRecord[], session: { sources: { recordId: number }[] }) =>
  session.sources.map((s) => records.find((r) => r.id === s.recordId)!.naturalKey).sort();

describe("reconcile edge cases", () => {
  it("matches a programmed WOD to the watch workout when there was no class that day", () => {
    const records = [workout("home", "2026-11-03T01:00:00Z", "2026-11-03T01:45:00Z", "2026-11-02"), ...wodup("s1", "2026-11-02", "2026-11-03T01:55:00Z", "2026-11-02")];
    const out = reconcile({ records, decisions: [], siteTz: TZ });
    expect(out.sessions).toHaveLength(1);
    expect(keysOf(records, out.sessions[0])).toContain("session:s1");
  });

  it("attaches a WOD to the nearest of two classes on the same day", () => {
    const records = [
      visit("am", "2026-11-04T14:00:00Z", "2026-11-04T15:00:00Z", "2026-11-04"),
      workout("am", "2026-11-04T14:01:00Z", "2026-11-04T14:55:00Z", "2026-11-04"),
      visit("pm", "2026-11-05T01:00:00Z", "2026-11-05T02:00:00Z", "2026-11-04"),
      workout("pm", "2026-11-05T01:01:00Z", "2026-11-05T01:56:00Z", "2026-11-04"),
      ...wodup("s2", "2026-11-04", "2026-11-05T02:10:00Z", "2026-11-04"),
    ];
    const out = reconcile({ records, decisions: [], siteTz: TZ });
    expect(out.sessions).toHaveLength(2);
    const pm = out.sessions.find((s) => keysOf(records, s).includes("visit:pm"))!;
    expect(keysOf(records, pm)).toContain("session:s2");
    expect(pm.flags).not.toContain("logged_hours_later");
  });

  it("keeps an open-gym workout that crosses midnight in one session", () => {
    const records = [
      workout("late", "2026-11-06T07:00:00Z", "2026-11-06T07:50:00Z", "2026-11-05"),
      ...wodup("s3", null, "2026-11-06T08:20:00Z", "2026-11-06"),
    ];
    const out = reconcile({ records, decisions: [], siteTz: TZ });
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0]).toMatchObject({ kind: "open_gym", localDate: "2026-11-05" });
  });
});
