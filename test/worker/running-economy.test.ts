import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { HrAggregatePayload } from "../../src/core/normalize";
import { metersPerBeat } from "../../src/core/running";
import { runReconcile } from "../../src/worker/reconcileStore";
import { authedFetch, createAthlete } from "./helpers";
import { fixtureAppleRecords, insertAllFixtureRecords } from "./seed";

let cookie: string;
beforeAll(async () => {
  cookie = await createAthlete();
  const id = (await (await authedFetch("/api/me", {}, cookie)).json<{ id: string }>()).id;
  await insertAllFixtureRecords(id);
  await runReconcile(env.DB, id, "America/Chicago");
});

const get = async (path: string): Promise<any> => (await authedFetch(path, {}, cookie)).json();
const keyOn = async (date: string): Promise<string> => (await get(`/api/tiles/recent_sessions?asOf=${date}`)).value[0].sessionKey;
const timelineOn = async (date: string): Promise<any> => get(`/api/sessions/${encodeURIComponent(await keyOn(date))}/timeline`);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("running form on a session", () => {
  it("shows distance, pace and the watch's form for a steady run", async () => {
    const t = await timelineOn("2026-10-25");
    const agg = fixtureAppleRecords.find((r) => r.kind === "hr_aggregate" && r.localDate === "2026-10-25")!.payload as HrAggregatePayload;
    expect(t.running).toEqual({
      powerW: 222,
      speedMps: 3.06,
      strideM: 1.06,
      groundContactMs: 261,
      verticalOscillationCm: 9.1,
      distanceM: 9970,
      paceSPerKm: 327,
      metersPerBeat: metersPerBeat(9970, 3260, agg.avg),
      verticalRatioPct: 8.6,
      cadenceSpm: 173,
      wholeRace: false,
    });
  });

  it("leaves out distance-based figures on race day, where indoor GPS is unreliable", async () => {
    const t = await timelineOn("2026-09-19");
    expect(t.running).toMatchObject({ wholeRace: true, distanceM: null, paceSPerKm: null, metersPerBeat: null, cadenceSpm: null, groundContactMs: 239 });
  });

  it("is absent for a class the watch logged as strength", async () => {
    expect((await timelineOn("2026-10-19")).running).toBeNull();
  });
});

describe("running economy tile", () => {
  it("trends steady runs only: no classes, races or time trials", async () => {
    const t = await get("/api/tiles/running_economy?asOf=2026-10-25");
    const dates = t.value.metrics[0].series.map((p: any) => p.date);
    expect(t.value.from).toBe("2026-04-27");
    expect(dates.at(-1)).toBe("2026-10-25");
    expect(dates.every((d: string) => d >= "2026-04-27" && d <= "2026-10-25")).toBe(true);
    expect(dates).not.toContain("2026-09-19"); // HYROX Dallas
    expect(dates).not.toContain("2026-10-01"); // 5k time trial at the track
    expect(dates).toContain("2026-10-18"); // 5k easy, also logged in WodUp
    expect(dates).not.toContain("2026-09-29"); // Run Club intervals
    expect(t.value.runs).toBe(dates.length);
  });

  it("agrees with the session page for the same run", async () => {
    const t = await get("/api/tiles/running_economy?asOf=2026-10-25");
    const mpb = t.value.metrics.find((m: any) => m.key === "metersPerBeat");
    expect(mpb.series.at(-1).value).toBe((await timelineOn("2026-10-25")).running.metersPerBeat);
  });

  it("compares the latest 4 steady runs with the first 4", async () => {
    const t = await get("/api/tiles/running_economy?asOf=2026-10-25");
    const places: Record<string, number> = { metersPerBeat: 2, paceSPerKm: 0, groundContactMs: 0, verticalRatioPct: 1, verticalOscillationCm: 1, strideM: 2, cadenceSpm: 0, powerW: 0 };
    const round = (n: number, p: number) => Math.round(n * 10 ** p) / 10 ** p;
    for (const m of t.value.metrics) {
      const v = m.series.map((p: any) => p.value);
      expect(m.compared).toBe(4);
      expect(m.now).toBe(round(mean(v.slice(-4)), places[m.key]));
      expect(m.then).toBe(round(mean(v.slice(0, 4)), places[m.key]));
    }
    const mpb = t.value.metrics.find((m: any) => m.key === "metersPerBeat");
    expect(t.value.metrics.find((m: any) => m.key === "groundContactMs").better).toBe("lower");
    const cadence = t.value.metrics.find((m: any) => m.key === "cadenceSpm");
    expect(cadence).toMatchObject({ better: null, note: "rises with pace" });
    expect(cadence.series.at(-1).value).toBe((await timelineOn("2026-10-25")).running.cadenceSpm);
    expect(t.display).toBe(`${mpb.nowDisplay} m per beat`);
    expect(t.spoken).toContain(mpb.nowDisplay);
    expect(t.spoken).toContain(mpb.thenDisplay);
    expect(t.calc.inputs.sourceRecordIds).toHaveLength(t.value.runs);
  });

  it("shows a single run without a comparison", async () => {
    const t = await get("/api/tiles/running_economy?asOf=2024-11-03");
    expect(t.value.runs).toBe(1);
    expect(t.value.metrics.every((m: any) => m.compared === 0 && m.then === null && m.series.length === 1)).toBe(true);
    expect(t.context).toBe("1 steady run in 26 weeks");
  });

  it("says so when there are no runs yet", async () => {
    const t = await get("/api/tiles/running_economy?asOf=2024-10-01");
    expect(t.value).toBeNull();
  });
});
