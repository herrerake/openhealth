import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveAsOf } from "../../src/worker/dashboard/asOf";
import { HOME_SPEC } from "../../src/worker/dashboard/spec";
import { runReconcile } from "../../src/worker/reconcileStore";
import { authedFetch, createAthlete } from "./helpers";
import { expectedFixture, fixtureAppleRecords, insertAllFixtureRecords } from "./seed";

const TZ = "America/Chicago";
const HOME_ORDER = HOME_SPEC.tiles.map((t) => t.type);

let cookie: string;
let athleteId: string;

async function seeded(): Promise<void> {
  cookie = await createAthlete();
  athleteId = (await (await authedFetch("/api/me", {}, cookie)).json<{ id: string }>()).id;
  await insertAllFixtureRecords(athleteId);
  await runReconcile(env.DB, athleteId, TZ);
}

const dash = async (query = "", c = cookie): Promise<any> => (await authedFetch(`/api/dashboards/home${query}`, {}, c)).json();

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekCount = (start: string) =>
  expectedFixture.canonicalWorkouts.filter((c: any) => c.localDate >= start && c.localDate <= addDays(start, 6)).length;
const expectedTypical = (weekStart: string) => {
  const counts = Array.from({ length: 12 }, (_, i) => weekCount(addDays(weekStart, -7 * (i + 1))));
  return (counts.reduce((a, b) => a + b, 0) / 12).toFixed(1);
};

describe("home dashboard", () => {
  beforeEach(seeded);

  it("returns the home spec and every tile", async () => {
    const d = await dash();
    expect(d.spec.tiles.map((t: any) => t.type)).toEqual(HOME_ORDER);
    expect(Object.keys(d.tiles).sort()).toEqual([...HOME_ORDER].sort());
  });

  it("demo mode is as of the latest synced day", async () => {
    expect((await dash()).asOf).toBe("2026-10-25");
  });

  it("an explicit asOf wins", async () => {
    expect((await dash("?asOf=2026-10-11")).asOf).toBe("2026-10-11");
  });

  it("counts this week and the typical week", async () => {
    const t = (await dash()).tiles.week_sessions;
    expect(t.value).toBe(weekCount("2026-10-19"));
    expect(t.context).toBe(`your typical week: ${expectedTypical("2026-10-19")}`);
  });

  it("reports the current and longest streak", async () => {
    const t = (await dash()).tiles.streak;
    expect(t.value).toBe(4);
    expect(t.context).toContain("longest: 14");
  });

  it("lists the five most recent sessions with sources", async () => {
    const t = (await dash()).tiles.recent_sessions;
    expect(t.value).toHaveLength(5);
    expect(t.value[0].localDate).toBe("2026-10-25");
    expect(t.value.map((s: any) => s.localDate)).toEqual(["2026-10-25", "2026-10-23", "2026-10-22", "2026-10-21", "2026-10-21"]);
    expect(t.value.find((s: any) => s.localDate === "2026-10-22").sources.sort()).toEqual(["apple_health", "mindbody", "wodup"]);
    const monday = (await dash("?asOf=2026-10-19")).tiles.recent_sessions.value[0];
    expect(monday).toMatchObject({ localDate: "2026-10-19", primary: "Deadlift 4x4 @285" });
    expect(monday.title).toMatch(/^Club Hybrid (6:5\d|7:0\d)$/);
    const race = (await dash("?asOf=2026-09-19")).tiles.recent_sessions.value[0];
    expect(race).toMatchObject({ localDate: "2026-09-19", title: "HYROX 2026 Dallas", primary: "HYROX 2026 Dallas 1:14:32" });
    expect(race.sources.sort()).toEqual(["apple_health", "hyrox"]);
  });

  it("training mix sums to 1", async () => {
    const v = (await dash()).tiles.training_mix.value;
    expect(Object.keys(v).sort()).toEqual(["metcon", "mixed", "race", "row", "run", "strength"]);
    expect(Object.values(v).reduce((a: number, b: any) => a + b, 0)).toBeCloseTo(1, 5);
  });

  it("every tile explains its calculation", async () => {
    for (const t of Object.values((await dash()).tiles) as any[]) expect(t.calc.description.length).toBeGreaterThan(10);
  });

  it("serves a single tile", async () => {
    const t = await (await authedFetch("/api/tiles/streak", {}, cookie)).json<any>();
    expect(t.type).toBe("streak");
    expect((await authedFetch("/api/tiles/nope", {}, cookie)).status).toBe(404);
  });
});

describe("dashboard edges", () => {
  it("tiles are empty, not broken, before any sync", async () => {
    const fresh = await createAthlete("New Athlete");
    const d = await dash("", fresh);
    for (const t of Object.values(d.tiles) as any[]) {
      if (t.type === "stories_placeholder") continue;
      expect(t.value).toBeNull();
      expect(t.display).toBe("No data yet");
    }
  });

  it("week boundaries follow the athlete's time zone", async () => {
    const make = async (tz: string) => {
      const r = await SELF.fetch("http://x/api/athletes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "T", tz }),
      });
      return ((await r.json()) as { id: string }).id;
    };
    const now = new Date("2026-10-19T04:30:00Z"); // 00:30 Monday in New York, 21:30 Sunday in Los Angeles
    const live = { ...env, PROVIDER_MODE: "live" };
    expect((await resolveAsOf(live, env.DB, await make("America/New_York"), undefined, now)).asOf).toBe("2026-10-19");
    expect((await resolveAsOf(live, env.DB, await make("America/Los_Angeles"), undefined, now)).asOf).toBe("2026-10-18");
  });

  it("requires a session", async () => {
    expect((await SELF.fetch("http://x/api/dashboards/home")).status).toBe(401);
  });
});


/** Recomputes a recovery tile from the raw fixture records (independent of the API's SQL). */
function expectedRecovery(type: "rhr" | "hrv", asOf: string) {
  const appleType = type === "rhr" ? "HKQuantityTypeIdentifierRestingHeartRate" : "HKQuantityTypeIdentifierHeartRateVariabilitySDNN";
  const byDate = new Map<string, number[]>();
  for (const r of fixtureAppleRecords) {
    const p = r.payload as any;
    if (r.kind !== "daily_metric" || p.type !== appleType) continue;
    byDate.set(r.localDate!, [...(byDate.get(r.localDate!) ?? []), Number(p.value)]);
  }
  const daily = (d: string) => {
    const v = byDate.get(d);
    return v ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const window = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => daily(addDays(asOf, -(to - i)))).filter((v): v is number => v != null);
  const last3 = window(0, 2);
  const base = window(3, 92);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const m = mean(base);
  const sd = Math.sqrt(mean(base.map((x) => (x - m) ** 2)));
  const value = Math.round(mean(last3) * 10) / 10;
  const low = Math.round(m - sd);
  const high = Math.round(m + sd);
  return { value, low, high, position: value < low ? "below" : value > high ? "above" : "inside" };
}

describe("records, recovery, heatmap, review", () => {
  beforeEach(seeded);
  const tileAsOf = async (type: string, asOf: string) =>
    (await authedFetch(`/api/tiles/${type}?asOf=${asOf}`, {}, cookie)).json<any>();

  it("record book scopes bests to the athlete's history", async () => {
    const t = (await dash()).tiles.record_book;
    const row = (b: string) => t.value.find((r: any) => r.benchmark === b);
    expect(row("hyrox_total")).toMatchObject({ best: 4472, bestDate: "2026-09-19", attempts: 4, latest: 4472, unit: "s" });
    expect(row("run_5k_tt")).toMatchObject({ best: 1135, bestDate: "2026-04-16", unit: "s" });
    // The one-off 295 day is still his best set; the story engine treats it as a decoy, the record book doesn't.
    expect(row("deadlift_4x4")).toMatchObject({ best: 295, bestDate: "2025-11-17", latest: 285, unit: "lb" });
    expect(row("amrap_40").unit).toBe("rounds");
    expect(row("amrap_40").best).toBe(Math.max(...row("amrap_40").series.map((p: any) => p.value)));
    expect(t.context).toBe("best in your history since 2024-10-28");
  });

  it("best results link to their source records", async () => {
    expect((await dash()).tiles.record_book.calc.inputs.sourceRecordIds).toHaveLength(4);
  });

  it("a record's detail lists every attempt and the progression of the best", async () => {
    const r = await (await authedFetch("/api/records/hyrox_total", {}, cookie)).json<any>();
    expect(r.attempts.map((a: any) => [a.value, a.pr, a.bestSoFar])).toEqual([
      [5294, false, 5294],
      [4900, true, 4900],
      [5095, false, 4900],
      [4472, true, 4472],
    ]);
    expect(r).toMatchObject({ best: { value: 4472, date: "2026-09-19" }, first: { value: 5294 }, change: 822, prCount: 2 });
    expect(r.attempts.at(-1).title).toBe("HYROX 2026 Dallas");
    expect(r.spoken).toBe("Your best HYROX finish is 1:14:32 from 4 attempts, 13:42 faster than your first.");
    expect(r.calc.inputs.sourceRecordIds).toHaveLength(4);
  });

  it("every attempt links to its session", async () => {
    const r = await (await authedFetch("/api/records/deadlift_4x4", {}, cookie)).json<any>();
    const tile = (await dash()).tiles.record_book.value.find((x: any) => x.benchmark === "deadlift_4x4");
    expect(r.attempts).toHaveLength(tile.attempts);
    expect(r.best).toMatchObject({ value: tile.best, date: tile.bestDate });
    expect(r.attempts.every((a: any) => typeof a.sessionKey === "string")).toBe(true);
    const session = await authedFetch(`/api/sessions/${encodeURIComponent(r.best.sessionKey)}`, {}, cookie);
    expect(session.status).toBe(200);
  });

  it("a record is as of the dashboard's day", async () => {
    const r = await (await authedFetch("/api/records/hyrox_total?asOf=2025-12-31", {}, cookie)).json<any>();
    expect(r.attempts).toHaveLength(2);
    expect(r.best.value).toBe(4900);
  });

  it("an unknown benchmark is not found", async () => {
    expect((await authedFetch("/api/records/fran", {}, cookie)).status).toBe(404);
    expect((await authedFetch("/api/records/hyrox_total?asOf=2024-01-01", {}, cookie)).status).toBe(404);
  });

  it("recovery tiles compare to the athlete's own normal", async () => {
    const d = await dash();
    expect(d.tiles.rhr_3d.value).toMatchObject(expectedRecovery("rhr", "2026-10-25"));
    expect(d.tiles.hrv_3d.value).toMatchObject(expectedRecovery("hrv", "2026-10-25"));
    expect(d.tiles.rhr_3d.context).toMatch(/90-day normal \(\d+–\d+\)/);
    expect(d.tiles.hrv_3d.value.sleepAvgMin7d).toBeGreaterThan(300);
    expect(d.tiles.rhr_3d.series).toHaveLength(14);
  });

  it("the heatmap marks data gaps, not zeros", async () => {
    const t = await tileAsOf("heatmap_52w", "2025-10-25");
    expect(t.value).toHaveLength(364);
    expect(t.value.find((d: any) => d.date === "2025-06-20")).toEqual({ date: "2025-06-20", sessions: 0, hasData: false });
    expect(t.value.find((d: any) => d.date === "2025-10-20").hasData).toBe(true);
    expect(t.context).toMatch(/^\d+ sessions this year · \d+ late cancels?$/);
  });

  it("the review queue lists the split, the conflict, and the late log", async () => {
    const t = (await dash()).tiles.review_queue;
    expect(t.value.items.map((i: any) => [i.localDate, i.kind])).toEqual([
      ["2026-10-02", "confirm"],
      ["2026-10-14", "merge_split"],
      ["2026-10-18", "pick"],
    ]);
    expect(t.value.count).toBe(3);
  });

  it("serves the home dashboard in under 300 ms", async () => {
    await dash();
    const t = performance.now();
    await dash();
    expect(performance.now() - t).toBeLessThan(300);
  });
});
