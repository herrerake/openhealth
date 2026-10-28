import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { registry } from "../../src/connectors/registry";
import type { SyncContext } from "../../src/connectors/types";
import type { ProviderId, SourceBatch, SourceRecordInput } from "../../src/core/types";
import { internalFetch, mockBaseUrl } from "../../src/worker/internal";
import { mintMockToken } from "../../src/worker/mock/oauth";
import { fixtureSessions, fixtureVisits, seedMockFixtures } from "./seed";

beforeEach(seedMockFixtures);

const EXTERNAL: Record<string, string> = { wodup: "ath_Hn4Rx8Yk", mindbody: "100015482", hyrox: "hx_walsh_henry" };

async function ctx(provider: ProviderId, fetchImpl?: typeof fetch): Promise<SyncContext> {
  return {
    athleteId: "a1",
    credentials: { token: await mintMockToken(provider, env.SESSION_SECRET), externalId: EXTERNAL[provider] ?? "demo" },
    siteTz: "America/Chicago",
    fetch: fetchImpl ?? internalFetch(env),
    baseUrl: mockBaseUrl(provider),
  };
}

async function collectBatches(it: AsyncIterable<SourceBatch>): Promise<SourceBatch[]> {
  const out: SourceBatch[] = [];
  for await (const b of it) out.push(b);
  return out;
}
const collect = async (it: AsyncIterable<SourceBatch>): Promise<SourceRecordInput[]> =>
  (await collectBatches(it)).flatMap((b) => b.records);

describe("WodUp connector", () => {
  it("WodUp sync yields every session and result once", async () => {
    const recs = await collect(registry.wodup.sync!(await ctx("wodup")));
    expect(recs.filter((r) => r.kind === "training_session")).toHaveLength(fixtureSessions.length);
    expect(recs.filter((r) => r.kind === "result")).toHaveLength(fixtureSessions.flatMap((s) => s.results).length);
    expect(new Set(recs.map((r) => r.naturalKey)).size).toBe(recs.length);
  });

  it("dates results by the WOD day and stores UTC times", async () => {
    const recs = await collect(registry.wodup.sync!(await ctx("wodup")));
    const loggedLate = recs.find((r) => r.kind === "result" && r.localDate === "2026-10-02" && r.startUtc! > "2026-10-03")!;
    expect(loggedLate.startUtc).toBe("2026-10-03T00:40:00Z");
  });

  it("an open-gym result after 5 pm keeps its local date", async () => {
    const recs = await collect(registry.wodup.sync!(await ctx("wodup")));
    expect(recs.some((r) => r.kind === "result" && r.localDate === "2026-10-21" && r.startUtc!.startsWith("2026-10-22"))).toBe(true);
  });

  it("reports progress per page", async () => {
    const batches = await collectBatches(registry.wodup.sync!(await ctx("wodup")));
    expect(batches.at(-1)!.progress).toEqual({ label: `WodUp · ${fixtureSessions.length} sessions`, done: fixtureSessions.length });
  });

  it("a 500 from the provider surfaces as a thrown error", async () => {
    const failing = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(collect(registry.wodup.sync!(await ctx("wodup", failing)))).rejects.toThrow(/wodup.*500/);
  });
});

describe("Mindbody connector", () => {
  it("yields every visit", async () => {
    const recs = await collect(registry.mindbody.sync!(await ctx("mindbody")));
    expect(recs).toHaveLength(fixtureVisits.length);
    expect(recs.every((r) => r.kind === "visit" && r.naturalKey.startsWith("visit:"))).toBe(true);
  });

  it("Mindbody sync converts local times across DST", async () => {
    const recs = await collect(registry.mindbody.sync!(await ctx("mindbody")));
    const winter = recs.find((r) => r.localDate === "2025-01-06")!;
    const summer = recs.find((r) => r.localDate === "2025-07-07")!;
    expect(winter.startUtc).toBe("2025-01-06T13:00:00Z");
    expect(summer.startUtc).toBe("2025-07-07T12:00:00Z");
  });
});

describe("HYROX connector", () => {
  it("yields one race record per result, spanning wave start to finish", async () => {
    const recs = await collect(registry.hyrox.sync!(await ctx("hyrox")));
    expect(recs.map((r) => r.localDate).sort()).toEqual(["2025-03-22", "2025-09-20", "2026-03-21", "2026-09-19"]);
    const dallas = recs.find((r) => r.localDate === "2026-09-19")!;
    expect(dallas).toMatchObject({ source: "hyrox", kind: "race_result", startUtc: "2026-09-19T17:10:00Z", endUtc: "2026-09-19T18:24:32Z" });
    expect((dallas.payload as any).workoutSummary).toHaveLength(19);
  });
});

describe("stub connectors", () => {
  it("stub sync yields an empty batch", async () => {
    expect(await collectBatches(registry.oura.sync!(await ctx("oura")))).toEqual([
      { records: [], progress: { label: "No data in demo", done: 0, total: 0 } },
    ]);
  });

  it("Apple Health has no server sync", () => {
    expect(registry.apple_health.sync).toBeUndefined();
  });
});
