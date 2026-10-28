import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { runReconcile } from "../../src/worker/reconcileStore";
import { authedFetch, createAthlete } from "./helpers";
import { insertAllFixtureRecords } from "./seed";

let cookie: string;
beforeAll(async () => {
  cookie = await createAthlete();
  const id = (await (await authedFetch("/api/me", {}, cookie)).json<{ id: string }>()).id;
  await insertAllFixtureRecords(id);
  await runReconcile(env.DB, id, "America/Chicago");
});

const get = async (path: string): Promise<any> => (await authedFetch(path, {}, cookie)).json();
const timelineOn = async (date: string): Promise<any> => {
  const key = (await get(`/api/tiles/recent_sessions?asOf=${date}`)).value[0].sessionKey;
  return get(`/api/sessions/${encodeURIComponent(key)}/timeline`);
};

describe("session timeline", () => {
  it("lays a race on the official HYROX splits", async () => {
    const t = await timelineOn("2026-09-19");
    expect(t).toMatchObject({ kind: "race", title: "HYROX 2026 Dallas", method: "hyrox_splits" });
    expect(t.blocks).toHaveLength(16);
    expect(t.blocks.every((b: any) => b.source === "official" && b.avgHr > 0)).toBe(true);
    expect(t.blocks.at(-1).label).toBe("Wall Balls");
    expect(t.hr.stepS).toBe(15);
  });

  it("names track reps from the watch's segments", async () => {
    const t = await timelineOn("2026-09-29");
    expect(t).toMatchObject({ kind: "class", title: "Run Club", method: "watch_segments" });
    expect(t.blocks[0].label).toBe("Warm Up");
    expect(t.blocks.at(-1).label).toBe("Cool Down");
    expect(t.blocks.some((b: any) => /^Rep \d+$/.test(b.label))).toBe(true);
  });

  it("matches Club Hybrid blocks to the heart rate, labeled as estimates", async () => {
    const t = await timelineOn("2026-10-19");
    expect(t).toMatchObject({ title: "Club Hybrid", method: "duration_match" });
    expect(t.blocks.map((b: any) => b.label)).toEqual(["Warm Up", "A. Deadlift", "B. Push Press", "C. Circuit", "D. FC finisher"]);
    expect(t.blocks.every((b: any) => b.source === "estimated" && b.avgHr > 0 && b.endS > b.startS)).toBe(true);
    expect(t.blocks[1].prescription).toContain("4 sets of 4 reps @ 80% of 1RM");
    expect(t.spoken).toMatch(/^Your hardest block was .+, averaging \d+ beats per minute, by estimated block times\.$/);
  });

  it("every number in the spoken line comes from a block", async () => {
    const t = await timelineOn("2026-10-19");
    const n = Number(/averaging (\d+)/.exec(t.spoken)![1]);
    expect(t.blocks.map((b: any) => b.avgHr)).toContain(n);
  });

  it("says a one-block workout has heart rate, not that none was recorded", async () => {
    const t = await timelineOn("2026-10-25");
    expect(t).toMatchObject({ method: "whole_workout" });
    expect(t.hr.points.length).toBeGreaterThan(0);
    expect(t.blocks).toHaveLength(1);
    expect(t.blocks[0].avgHr).toBeGreaterThan(0);
  });

  it("shows the plan without times when the watch recorded nothing", async () => {
    const t = await timelineOn("2026-10-06");
    expect(t).toMatchObject({ method: "none", hr: null });
    expect(t.blocks.every((b: any) => b.startS === null)).toBe(true);
  });
});
