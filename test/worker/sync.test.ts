import { SELF, env } from "cloudflare:test";
import { getAgentByName } from "agents";
import { beforeEach, describe, expect, it } from "vitest";
import type { SyncState } from "../../src/worker/agent";
import { authedFetch, currentCookie } from "./helpers";
import { expectedFixture, fixtureAppleRecords, seedMockFixtures } from "./seed";

beforeEach(seedMockFixtures);

async function athleteId(): Promise<string> {
  const me = await (await authedFetch("/api/me")).json<{ id: string }>();
  return me.id;
}
const agentFor = async () => getAgentByName(env.AthleteAgent, await athleteId());

async function connect(provider: string): Promise<void> {
  const start = await authedFetch(`/api/connect/${provider}/start`, { redirect: "manual" });
  const auth = new URL(start.headers.get("location")!, "http://x");
  auth.searchParams.set("auto", "1");
  const back = await SELF.fetch(auth.toString(), { redirect: "manual" });
  const cb = new URL(back.headers.get("location")!, "http://x");
  await authedFetch(cb.pathname + cb.search, { redirect: "manual" });
}
const connectAll = async (providers: string[]) => {
  for (const p of providers) await connect(p);
};

async function uploadAppleFixture(): Promise<void> {
  for (let i = 0; i < fixtureAppleRecords.length; i += 2000) {
    await authedFetch("/api/connect/apple_health/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileSha256: "f".repeat(64), records: fixtureAppleRecords.slice(i, i + 2000) }),
    });
  }
}

async function waitForSync(runId: string): Promise<SyncState> {
  const agent = await agentFor();
  for (let i = 0; i < 600; i++) {
    const s = await agent.getSyncState();
    if (s.runId === runId && (s.status === "done" || s.status === "error")) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("sync did not finish");
}

async function syncOnce(providers?: string[]): Promise<SyncState> {
  const r = await authedFetch("/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(providers ? { providers } : {}),
  });
  expect(r.status).toBe(202);
  const { runId } = await r.json<{ runId: string }>();
  return waitForSync(runId);
}

const runTotals = async (runId: string) =>
  (await env.DB.prepare("SELECT sum(accepted) a, sum(duplicates) d FROM sync_runs WHERE run_id = ?").bind(runId).first<{ a: number; d: number }>())!;

describe("sync runs", () => {
  it("syncs connected providers and reconciles", async () => {
    await connectAll(["wodup", "mindbody"]);
    await uploadAppleFixture();
    const s = await syncOnce();
    expect(s.status).toBe("done");
    expect(s.providers.wodup!.status).toBe("done");
    expect(s.providers.mindbody!.status).toBe("done");
    expect(s.reconcile.status).toBe("done");
    expect(s.summary!.workouts).toBe(expectedFixture.canonicalWorkouts.length);
    expect(s.summary!.needsReview).toBe(1);
    expect(s.summary!.timings.wodup + s.summary!.timings.mindbody).toBeLessThan(10_000);
    expect(s.summary!.timings.reconcile).toBeLessThan(5_000);
  });

  it("second sync adds nothing", async () => {
    await connectAll(["wodup", "mindbody"]);
    await syncOnce();
    const again = await syncOnce();
    const totals = await runTotals(again.runId!);
    expect(totals.a).toBe(0);
    expect(totals.d).toBeGreaterThan(0);
  });

  it("one failing provider doesn't stop the others", async () => {
    await connectAll(["wodup", "mindbody"]);
    await env.RAW.put("mock/fail/mindbody", "1");
    const s = await syncOnce();
    expect(s.providers.mindbody!.status).toBe("error");
    expect(s.providers.mindbody!.error).toMatch(/500/);
    expect(s.providers.wodup!.status).toBe("done");
    expect(s.status).toBe("done");
    const me = await (await authedFetch("/api/me")).json<any>();
    expect(me.connections.find((c: any) => c.provider === "mindbody").status).toBe("error");
  });

  it("startSync while running returns the active run", async () => {
    await connectAll(["wodup"]);
    const agent = await agentFor();
    const a = await agent.startSync();
    const b = await agent.startSync();
    expect(b.runId).toBe(a.runId);
    await waitForSync(a.runId);
  });

  it("stale running run is closed on next start", async () => {
    await connectAll(["wodup"]);
    const id = await athleteId();
    await env.DB.prepare(
      "INSERT INTO sync_runs (id, run_id, athlete_id, provider, started_at, status) VALUES ('stale:wodup', 'stale', ?, 'wodup', '2026-01-01T00:00:00Z', 'running')",
    )
      .bind(id)
      .run();
    const agent = await agentFor();
    await waitForSync((await agent.startSync()).runId);
    const row = await env.DB.prepare("SELECT status, detail FROM sync_runs WHERE id = 'stale:wodup'").first<{ status: string; detail: string }>();
    expect(row!.status).toBe("error");
    expect(JSON.parse(row!.detail)).toMatchObject({ reason: "interrupted" });
  });

  it("stub providers complete with zero records", async () => {
    await connectAll(["oura"]);
    const s = await syncOnce(["oura"]);
    expect(s.providers.oura).toMatchObject({ status: "done", label: "No data in demo" });
  });

  it("rejects sync for an unknown provider", async () => {
    await currentCookie();
    const r = await authedFetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ providers: ["strava"] }) });
    expect(r.status).toBe(400);
  });
});
