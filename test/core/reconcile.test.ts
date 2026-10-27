import { beforeAll, describe, expect, it } from "vitest";
import { type ReconcileResult, type SessionOut, reconcile } from "../../src/core/reconcile";
import type { StoredSourceRecord } from "../../src/core/types";
import { readExpected } from "./fixture-helpers";
import { TZ, fixtureRecords } from "./records-helper";

const RECONCILE_FLAGS = new Set([
  "logged_hours_later",
  "missing_apple_workout",
  "utc_date_differs_from_local",
  "no_booking",
  "ambiguous_split_apple_workout",
]);
const COMPARED_KINDS = new Set(["visit", "training_session", "workout"]);

let records: StoredSourceRecord[];
let byId: Map<number, StoredSourceRecord>;
let expected: any;
let r: ReconcileResult;
let ms: number;

beforeAll(async () => {
  records = await fixtureRecords();
  byId = new Map(records.map((x) => [x.id, x]));
  expected = readExpected();
  const t = performance.now();
  r = reconcile({ records, decisions: [], siteTz: TZ });
  ms = performance.now() - t;
}, 120_000);

const keyOf = (id: number) => byId.get(id)!.naturalKey;

function toComparable(sessions: SessionOut[]) {
  return sessions
    .map((s) => ({
      localDate: s.localDate,
      kind: s.kind,
      status: s.status,
      flags: s.flags.filter((f) => RECONCILE_FLAGS.has(f)).sort(),
      sources: s.sources
        .filter((x) => x.role !== "duplicate" && COMPARED_KINDS.has(byId.get(x.recordId)!.kind))
        .map((x) => keyOf(x.recordId))
        .sort(),
    }))
    .sort((a, b) => a.localDate.localeCompare(b.localDate) || a.sources.join().localeCompare(b.sources.join()));
}

function expectedComparable() {
  return expected.canonicalWorkouts
    .map((c: any) => ({
      localDate: c.localDate,
      kind: c.kind,
      status: c.status,
      flags: c.flags.filter((f: string) => RECONCILE_FLAGS.has(f)).sort(),
      sources: [
        ...(c.sources.mindbodyVisitId ? [`visit:${c.sources.mindbodyVisitId}`] : []),
        ...(c.sources.wodupSessionId ? [`session:${c.sources.wodupSessionId}`] : []),
        ...c.sources.appleWorkouts.map((k: string) => `workout:${k}`),
      ].sort(),
    }))
    .sort((a: any, b: any) => a.localDate.localeCompare(b.localDate) || a.sources.join().localeCompare(b.sources.join()));
}

const reasonOf = (reason: string) => (reason.startsWith("no_show") ? "no_show" : reason);

describe("reconcile", () => {
  it("matches expected sessions across two years", () => {
    expect(toComparable(r.sessions)).toEqual(expectedComparable());
  });

  it("reports unmatched visits with reasons", () => {
    const got = r.unmatchedVisits.map((u) => `${keyOf(u.recordId)}:${u.reason}`).sort();
    const want = expected.unmatchedVisits.map((u: any) => `visit:${u.mindbodyVisitId}:${reasonOf(u.reason)}`).sort();
    expect(got).toEqual(want);
  });

  it("keeps the Watch and drops Strava", () => {
    const got = r.duplicates.map((d) => [keyOf(d.kept), keyOf(d.duplicate)]).sort();
    const want = expected.duplicates.map((d: any) => [`workout:${d.kept}`, `workout:${d.duplicate}`]).sort();
    expect(got).toEqual(want);
  });

  it("never averages a conflict", () => {
    expect(r.conflicts).toHaveLength(expected.conflicts.length * 2);
    expect(r.conflicts.find((c) => c.field === "distance_m")).toMatchObject({
      values: { wodup: 5000, apple_health: 5210 },
      chosen: "apple_health",
      resolvedBy: "rule",
    });
    expect(r.conflicts.find((c) => c.field === "duration_s")).toMatchObject({ values: { wodup: 1470, apple_health: 1492 } });
  });

  it("attaches results and heart-rate aggregates as supporting records", () => {
    const fran = r.sessions.find((s) => s.localDate === "2026-10-20" && s.kind === "class")!;
    const kinds = fran.sources.map((x) => byId.get(x.recordId)!.kind).sort();
    expect(kinds).toEqual(["hr_aggregate", "result", "training_session", "visit", "workout"]);
    expect(fran.sources.find((x) => byId.get(x.recordId)!.kind === "visit")!.role).toBe("anchor");
  });

  it("categorizes sessions by their primary result", () => {
    expect(r.sessions.find((s) => s.localDate === "2026-10-19")!.category).toBe("strength");
    expect(r.sessions.find((s) => s.localDate === "2026-10-20" && s.kind === "class")!.category).toBe("metcon");
    expect(r.sessions.find((s) => s.localDate === "2026-10-25")!.category).toBe("run");
  });

  it("a merge decision survives re-run", () => {
    const split = r.sessions.find((s) => s.status === "review_required" && s.localDate === "2026-10-17")!;
    const again = reconcile({ records, siteTz: TZ, decisions: [{ scopeKey: split.key, action: "merge", payload: {} }] });
    expect(again.sessions.find((s) => s.key === split.key)!.status).toBe("confirmed");
  });

  it("a split decision separates the watch workouts", () => {
    const split = r.sessions.find((s) => s.status === "review_required" && s.localDate === "2026-10-17")!;
    const again = reconcile({ records, siteTz: TZ, decisions: [{ scopeKey: split.key, action: "split", payload: {} }] });
    const day = again.sessions.filter((s) => s.localDate === "2026-10-17");
    expect(day).toHaveLength(2);
    expect(day.every((s) => s.status === "confirmed")).toBe(true);
  });

  it("a confirm decision clears review on a late-logged class", () => {
    const late = r.sessions.find((s) => s.flags.includes("logged_hours_later"))!;
    const again = reconcile({ records, siteTz: TZ, decisions: [{ scopeKey: late.key, action: "confirm", payload: {} }] });
    expect(again.sessions.find((s) => s.key === late.key)!.status).toBe("confirmed");
  });

  it("a pick decision overrides the rule for a conflict", () => {
    const run = r.sessions.find((s) => s.localDate === "2026-10-18")!;
    const again = reconcile({ records, siteTz: TZ, decisions: [{ scopeKey: run.key, action: "pick", payload: { field: "distance_m", source: "wodup" } }] });
    expect(again.conflicts.find((c) => c.field === "distance_m")).toMatchObject({ chosen: "wodup", resolvedBy: "athlete" });
  });

  it("open gym after 5 pm stays on the local date", () => {
    expect(r.sessions.find((s) => s.kind === "open_gym" && s.startUtc.startsWith("2026-10-22"))!.localDate).toBe("2026-10-21");
  });

  it("is deterministic", () => {
    expect(reconcile({ records: [...records].reverse(), decisions: [], siteTz: TZ })).toEqual(r);
  });

  it("reconciles two years in under 5 s", () => {
    expect(ms).toBeLessThan(5000);
  });
});
