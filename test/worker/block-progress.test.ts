import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { runReconcile } from "../../src/worker/reconcileStore";
import { authedFetch, createAthlete } from "./helpers";
import { expectedFixture, fixtureAppleRecords, insertAllFixtureRecords } from "./seed";

let cookie: string;
beforeAll(async () => {
  cookie = await createAthlete();
  const id = (await (await authedFetch("/api/me", {}, cookie)).json<{ id: string }>()).id;
  await insertAllFixtureRecords(id);
  await runReconcile(env.DB, id, "America/Chicago");
});

const tile = async (asOf: string, c = cookie): Promise<any> => (await authedFetch(`/api/tiles/block_progress?asOf=${asOf}`, {}, c)).json();
const session = (t: any, key: string) => t.value.sessions.find((s: any) => s.key === key);
const facts = expectedFixture.storylines.find((s: any) => s.id === "block_build").facts.blocks as any[];

/** The true average heart rate over a class block, from the fixtures' real block times (expected.timelines). */
function trueBlockHr(date: string, label: string): number {
  const t = expectedFixture.timelines.find((x: any) => x.localDate === date && x.kind === "class");
  const series = fixtureAppleRecords.find((r) => r.naturalKey === `hrs:workout:${t.appleWorkout}`)!;
  const start = Date.parse(series.startUtc!);
  const b = t.blocks.find((x: any) => x.label === label);
  const [from, to] = [b.start, b.end].map((x: string) => (Date.parse(x) - start) / 1000);
  const inside = (series.payload as any).points.filter(([s]: number[]) => s >= from && s < to).map(([, bpm]: number[]) => bpm);
  return inside.reduce((a: number, b: number) => a + b, 0) / inside.length;
}

describe("block progress tile", () => {
  it("says where Henry is on the Club Hybrid calendar", async () => {
    const t = await tile("2026-10-25");
    expect(t.display).toBe("Week 8 of 8, Block 13");
    expect(t.context).toBe("Club Hybrid · block 13 runs 2026-08-31 to 2026-10-25");
    expect(t.value).toMatchObject({ program: "Club Hybrid", block: 13, week: 8, weeks: 8, from: "2026-08-31", to: "2026-10-25" });
    expect((await tile("2026-10-07")).display).toBe("Week 6 of 8, Block 13");
    expect((await tile("2025-03-01")).display).toBe("Week 2 of 8, Block 3");
  });

  it("finds each repeated session's weeks from the results", async () => {
    const t = await tile("2026-10-25");
    expect(t.value.sessions.map((s: any) => [s.key, s.weeks])).toEqual([
      ["deadlift_4x4", [6, 8]],
      ["threshold_intervals", [6, 8]],
      ["amrap_40", [8]],
    ]);
  });

  it("compares week 6 with week 8 inside the current block", async () => {
    const t = await tile("2026-10-25");
    const last = facts.at(-1);
    const dl = session(t, "deadlift_4x4");
    expect(dl.thisBlock.map((w: any) => [w.week, w.entry.value, w.entry.date])).toEqual([
      [6, last.deadlift4x4W6, "2026-10-05"],
      [8, last.deadlift4x4W8, "2026-10-19"],
    ]);
    expect(dl.inBlockChangeDisplay).toBe("level");
    const ti = session(t, "threshold_intervals");
    expect(ti.thisBlock.map((w: any) => [w.week, w.entry.value, w.entry.date])).toEqual([
      [6, last.thresholdRepsW6, "2026-10-07"],
      [8, last.thresholdRepsW8, "2026-10-21"],
    ]);
    expect(ti.inBlockChange).toBe(last.thresholdRepsW8 - last.thresholdRepsW6);
    expect(ti.inBlockChangeDisplay).toBe(`+${last.thresholdRepsW8 - last.thresholdRepsW6} reps`);
    const amrap = session(t, "amrap_40");
    expect(amrap.thisBlock.map((w: any) => [w.week, w.entry.value, w.entry.date])).toEqual([[8, last.amrap40W8, "2026-10-23"]]);
  });

  it("takes heart rate for the threshold rounds and the AMRAP from the session timeline", async () => {
    const t = await tile("2026-10-25");
    const ti = session(t, "threshold_intervals").thisBlock;
    for (const w of ti) {
      expect(w.entry.hrMethod).toBe("duration_match");
      expect(Math.abs(w.entry.avgHr - trueBlockHr(w.entry.date, "A. Threshold Intervals"))).toBeLessThan(3);
    }
    const amrap = session(t, "amrap_40").thisBlock[0].entry;
    expect(Math.abs(amrap.avgHr - trueBlockHr("2026-10-23", "A. Main Block"))).toBeLessThan(3);
    // The same number the session page shows for that block.
    const timeline: any = await (await authedFetch(`/api/sessions/${encodeURIComponent(ti[1].entry.sessionKey)}/timeline`, {}, cookie)).json();
    expect(timeline.blocks.find((b: any) => b.label === "A. Threshold Intervals").avgHr).toBe(ti[1].entry.avgHr);
    expect(session(t, "deadlift_4x4").thisBlock[0].entry.avgHr).toBeNull();
  });

  it("lists the same sessions block over block, matching the block_build storyline", async () => {
    const t = await tile("2026-10-25");
    const weekValue = (key: string, week: number) =>
      session(t, key).blocks.map((b: any) => [b.block, b.entries.find((e: any) => e.week === week)?.value]);
    expect(weekValue("deadlift_4x4", 6)).toEqual(facts.map((f) => [f.block, f.deadlift4x4W6]));
    expect(weekValue("deadlift_4x4", 8)).toEqual(facts.map((f) => [f.block, f.deadlift4x4W8]));
    expect(weekValue("threshold_intervals", 6)).toEqual(facts.map((f) => [f.block, f.thresholdRepsW6]));
    expect(weekValue("threshold_intervals", 8)).toEqual(facts.map((f) => [f.block, f.thresholdRepsW8]));
    expect(weekValue("amrap_40", 8)).toEqual(facts.map((f) => [f.block, f.amrap40W8]));
    expect(session(t, "amrap_40").blocks[0]).toMatchObject({ block: 1, from: "2024-10-28" });
    expect(session(t, "amrap_40").sinceFirst).toEqual({ fromBlock: 1, toBlock: 13, change: 1.4, display: "+1.4 rounds" });
    expect(session(t, "threshold_intervals").sinceFirst.display).toBe(`+${facts.at(-1).thresholdRepsW8 - facts[0].thresholdRepsW8} reps`);
  });

  it("shows only what has happened by the day", async () => {
    const t = await tile("2026-10-07");
    expect(session(t, "threshold_intervals").thisBlock.map((w: any) => w.entry?.value ?? null)).toEqual([190, null]);
    expect(session(t, "threshold_intervals").inBlockChange).toBeNull();
    expect(session(t, "amrap_40").thisBlock).toEqual([{ week: 8, entry: null }]);
    expect(session(t, "amrap_40").blocks.at(-1).block).toBe(12);
  });

  it("speaks one sentence from the same numbers", async () => {
    const cases: [string, string][] = [
      ["2026-10-25", "In week 8 of 8, block 13, you logged 5.6 rounds on the 40-min AMRAP, against 5.8 rounds in block 12."],
      ["2026-10-21", "In week 8 of 8, block 13, you logged 193 reps on Threshold Intervals, against 190 reps in week 6."],
      ["2026-10-07", "In week 6 of 8, block 13, you logged 190 reps on Threshold Intervals, against 185 reps in block 12."],
      ["2026-09-02", "You're in week 1 of 8, block 13; no repeated sessions logged yet this block."],
    ];
    for (const [asOf, spoken] of cases) {
      const t = await tile(asOf);
      expect(t.spoken).toBe(spoken);
      expect(t.spoken.split(/\s+/).length).toBeLessThanOrEqual(25);
      const said = JSON.stringify([t.value, t.display, t.context]);
      for (const n of t.spoken.match(/\d+(\.\d+)?/g)) expect(said).toContain(n);
    }
  });

  it("explains itself and cites the results it used", async () => {
    const t = await tile("2026-10-25");
    expect(t.calc.description).toContain("8-week blocks from 2024-10-28");
    expect(t.calc.inputs.sourceRecordIds).toHaveLength(13 * 2 + 13 * 2 + 13);
  });

  it("is empty before the first block and for an athlete with no Club Hybrid results", async () => {
    expect((await tile("2024-10-01")).value).toBeNull();
    expect((await tile("2026-10-25", await createAthlete("New Athlete"))).value).toBeNull();
  });
});
