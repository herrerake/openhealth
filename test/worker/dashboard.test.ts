import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveAsOf } from "../../src/worker/dashboard/asOf";
import { HOME_SPEC } from "../../src/worker/dashboard/spec";
import { runReconcile } from "../../src/worker/reconcileStore";
import { authedFetch, createAthlete } from "./helpers";
import { expectedFixture, insertAllFixtureRecords } from "./seed";

const TZ = "America/Los_Angeles";
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
    expect(t.value.map((s: any) => s.localDate)).toEqual(["2026-10-25", "2026-10-24", "2026-10-23", "2026-10-22", "2026-10-21"]);
    expect(t.value.find((s: any) => s.localDate === "2026-10-22").sources.sort()).toEqual(["apple_health", "mindbody", "wodup"]);
    const fran = (await dash("?asOf=2026-10-20")).tiles.recent_sessions.value[0];
    expect(fran).toMatchObject({ localDate: "2026-10-20", primary: "Fran 4:21 rx" });
    expect(fran.title).toMatch(/^CrossFit 6:0\d$/);
  });

  it("training mix sums to 1", async () => {
    const v = (await dash()).tiles.training_mix.value;
    expect(Object.keys(v).sort()).toEqual(["metcon", "mixed", "row", "run", "strength"]);
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
