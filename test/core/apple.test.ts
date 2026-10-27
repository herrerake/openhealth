import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAppleExport } from "../../src/core/apple/parse";
import { Sha256 } from "../../src/core/apple/sha256";
import { unzipExport } from "../../src/core/apple/unzip";
import type { SourceRecordInput } from "../../src/core/types";
import { appleXmlPath, ensureGenerated } from "./fixture-helpers";

async function* fileChunks(path: string): AsyncIterable<Uint8Array> {
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) yield chunk as Uint8Array;
}
async function* chunksOf(text: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(text);
}
async function all(gen: AsyncIterable<SourceRecordInput[]>): Promise<SourceRecordInput[]> {
  const out: SourceRecordInput[] = [];
  for await (const batch of gen) out.push(...batch);
  return out;
}
const wrap = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE HealthData>\n<HealthData locale="en_US">\n${inner}\n</HealthData>\n`;
async function oneWorkout(fragment: string): Promise<SourceRecordInput> {
  const recs = await all(parseAppleExport(() => chunksOf(wrap(fragment))));
  return recs.find((r) => r.kind === "workout")!;
}
const workoutAt = (start: string) =>
  `<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" sourceName="Watch" startDate="${start}" endDate="${start}"/>`;

let xml: string;
let recs: SourceRecordInput[];
let parseMs: number;

/** Average and max of raw HR samples inside the watch workout starting on `date` (computed from the XML text). */
function directHrStats(date: string) {
  const w = [...xml.matchAll(/<Workout [^>]*sourceName="Alex’s Apple Watch"[^>]*startDate="([^"]+)" endDate="([^"]+)"/g)].find((m) =>
    m[1].startsWith(date),
  )!;
  const toMs = (s: string) => {
    const [d, t, off] = s.split(" ");
    const sign = off[0] === "-" ? -1 : 1;
    return Date.parse(`${d}T${t}Z`) - sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(3))) * 60_000;
  };
  const [start, end] = [toMs(w[1]), toMs(w[2])];
  const values = [...xml.matchAll(/type="HKQuantityTypeIdentifierHeartRate"[^>]*startDate="([^"]+)"[^>]*value="([\d.]+)"/g)]
    .filter((m) => toMs(m[1]) >= start && toMs(m[1]) <= end)
    .map((m) => Number(m[2]));
  return { avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10, max: Math.max(...values), samples: values.length };
}

beforeAll(async () => {
  ensureGenerated();
  xml = readFileSync(appleXmlPath, "utf8");
  const t = performance.now();
  recs = await all(parseAppleExport(() => fileChunks(appleXmlPath)));
  parseMs = performance.now() - t;
}, 60_000);

describe("streaming SHA-256", () => {
  it("matches node:crypto across chunk boundaries", () => {
    const data = new TextEncoder().encode("abc".repeat(100_003));
    const h = new Sha256();
    for (let i = 0; i < data.length; i += 7_919) h.update(data.subarray(i, i + 7_919));
    expect(h.hex()).toBe(createHash("sha256").update(data).digest("hex"));
  });
});

describe("Apple Health export parser", () => {
  it("parses the fixture within 15 s", () => {
    expect(parseMs).toBeLessThan(15_000);
    expect(recs.filter((r) => r.kind === "workout").length).toBe((xml.match(/<Workout /g) ?? []).length);
  });

  it("never emits raw heart-rate samples", () => {
    expect(recs.some((r) => (r.payload as any).type === "HKQuantityTypeIdentifierHeartRate")).toBe(false);
  });

  it("emits daily resting HR, HRV and sleep records", () => {
    const types = new Set(recs.filter((r) => r.kind === "daily_metric").map((r) => (r.payload as any).type));
    expect([...types].sort()).toEqual([
      "HKCategoryTypeIdentifierSleepAnalysis",
      "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
      "HKQuantityTypeIdentifierRestingHeartRate",
    ]);
  });

  it("HR aggregates equal a direct computation", () => {
    const agg = recs.find((r) => r.kind === "hr_aggregate" && r.localDate === "2026-10-20" && r.naturalKey.includes("Apple Watch"))!;
    expect(agg.payload).toMatchObject(directHrStats("2026-10-20"));
  });

  it("counts the mid-workout heart-rate gap", () => {
    const agg = recs.find((r) => r.kind === "hr_aggregate" && r.localDate === "2026-10-12")!;
    expect((agg.payload as any).gapsOver5Min).toBe(1);
  });

  it("keeps the Strava duplicate as its own record", () => {
    expect(recs.filter((r) => r.kind === "workout" && r.naturalKey.includes("2026-10-04 07:30:00"))).toHaveLength(2);
  });

  it("stamps aggregates with the file hash", () => {
    const hash = createHash("sha256").update(readFileSync(appleXmlPath)).digest("hex");
    expect(recs.filter((r) => r.kind === "hr_aggregate").every((r) => (r.payload as any).fileSha256 === hash)).toBe(true);
  });

  it("reads WorkoutStatistics totals", () => {
    const run = recs.find((r) => r.kind === "workout" && r.naturalKey.includes("Apple Watch|HKWorkoutActivityTypeRunning|2026-10-18"))!;
    expect((run.payload as any).totals).toMatchObject({ distance_m: 5210, duration_s: 1492 });
  });

  it("parses attribute-style workout totals", async () => {
    const w = await oneWorkout(
      `<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" totalDistance="5.0" totalDistanceUnit="km" totalEnergyBurned="300" totalEnergyBurnedUnit="Cal" sourceName="Old Watch" startDate="2019-05-01 07:00:00 -0700" endDate="2019-05-01 07:30:00 -0700"/>`,
    );
    expect(w.payload).toMatchObject({ totals: { distance_m: 5000, active_kcal: 300, duration_s: 1800 } });
  });

  it("uses the record's own offset for local_date", async () => {
    const w = await oneWorkout(workoutAt("2026-03-01 23:30:00 -0400"));
    expect(w.localDate).toBe("2026-03-01");
    expect(w.startUtc).toBe("2026-03-02T03:30:00Z");
  });

  it("reads a zipped export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oh-apple-"));
    const zipPath = join(dir, "export.zip");
    writeFileSync(zipPath, zipSync({ "apple_health_export/export.xml": readFileSync(appleXmlPath), "apple_health_export/export_cda.xml": new Uint8Array(10) }));
    expect((await all(parseAppleExport(() => unzipExport(fileChunks(zipPath))))).length).toBe(recs.length);
  }, 60_000);

  it("fails clearly on malformed XML", async () => {
    await expect(all(parseAppleExport(() => chunksOf("<HealthData><Workout")))).rejects.toThrow(/Apple Health export.*malformed/);
  });

  it("fails clearly on a zip without export.xml", async () => {
    const bytes = zipSync({ "something/else.txt": new Uint8Array(3) });
    async function* one() {
      yield bytes;
    }
    await expect(all(parseAppleExport(() => unzipExport(one())))).rejects.toThrow(/export\.xml/);
  });
});
